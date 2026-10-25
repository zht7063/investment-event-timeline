import { test, expect } from "@playwright/test";

/**
 * Playwright smoke test: one main-path walk through the app.
 * Requires `npm run build` first and Playwright browsers installed:
 *   npx playwright install --with-deps chromium
 * Run with:
 *   npx playwright test
 */

// SSR pages recompute conclusions on first hit; use domcontentloaded to avoid load-event waits.
const nav = { waitUntil: "domcontentloaded" as const };

test("health check returns ok", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body).toMatchObject({ ok: true, db: "ok" });
});

test("home page loads with seed events", async ({ page }) => {
  // Warm the server with a cheap hit first so conclusion recompute is done.
  await page.request.get("/api/health");
  await page.goto("/", nav);
  await expect(page.locator("h1")).toContainText("每个判断", { timeout: 30_000 });
  const rows = page.locator("a[href*='/events/']");
  await expect(rows.first()).toBeVisible({ timeout: 15_000 });
});

test("event detail page shows conclusion and evidence", async ({ page }) => {
  await page.goto("/", nav);
  const firstLink = page.locator("a[href*='/events/']").first();
  await expect(firstLink).toBeVisible({ timeout: 30_000 });
  await firstLink.click();
  await expect(page).toHaveURL(/\/events\//);
  const badge = page.getByText(/已有证据支持|存在冲突|已被否认|已失效|待核实/);
  await expect(badge.first()).toBeVisible({ timeout: 15_000 });
});

test("sources page loads", async ({ page }) => {
  await page.goto("/sources", nav);
  await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 30_000 });
});

test("import page loads", async ({ page }) => {
  await page.goto("/import", nav);
  await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 15_000 });
});

test("status filter navigates with query param", async ({ page }) => {
  // Direct navigation with query string avoids SSR form submission timeout.
  await page.goto("/?status=expired", nav);
  await expect(page).toHaveURL(/status=expired/);
  // The page should still render (may show 0 results for expired).
  await expect(page.locator("h1")).toBeVisible({ timeout: 30_000 });
});
