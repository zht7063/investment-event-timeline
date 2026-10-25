import { test, expect } from "@playwright/test";

test("research validates fields and supports keyboard entry at mobile width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/research");
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  await expect(page.getByLabel("股票代码", { exact: true })).toBeFocused();
  await expect(page.locator("#code-error")).toContainText("六位");
  await page.getByLabel("股票代码", { exact: true }).fill("600519");
  await page.getByLabel("起始披露日期").fill("2026-09-07");
  await page.getByLabel("截止披露日期").fill("2026-09-01");
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  await expect(page.getByLabel("截止披露日期")).toBeFocused();
  await expect(page.locator("#end-error")).toContainText("早于");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("new stock automatically fetches both pages, analyzes and cites conflicting evidence after reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/research");
  await page.getByLabel("股票代码", { exact: true }).fill("600519.SH");
  await page.getByLabel("起始披露日期").fill("2026-09-01");
  await page.getByLabel("截止披露日期").fill("2026-09-07");
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  await expect(page).toHaveURL(/\/research\/[a-f0-9-]+/);
  const id = new URL(page.url()).pathname.split("/").at(-1);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "贵州茅台",
    { timeout: 20000 },
  );
  await expect(page.getByText("部分完成", { exact: true })).toBeVisible({
    timeout: 40000,
  });
  await expect(page.getByText("存在冲突", { exact: true })).toBeVisible();
  await page.getByText("查看 2 条证据与时间线", { exact: true }).click();
  await expect(page.locator(".research-evidence blockquote")).toHaveCount(2);
  await expect(
    page.getByText("后续公告明确否认获批报道", { exact: false }),
  ).toBeVisible();
  const r = await (await page.request.get(`/api/research/${id}`)).json();
  expect(r.total).toBe(2);
  expect(r.report.body.events[0].conclusion.status).toBe("conflicted");
  expect(
    r.sources.find((s: { source_id: string }) => s.source_id === "fuyao-news")
      .state.requests,
  ).toBe(2);
  await page.screenshot({
    path: test.info().outputPath("research-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: test.info().outputPath("research-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("cancel is durable and failed polling preserves results with a retry action", async ({
  page,
}) => {
  const created = await page.request.post("/api/research", {
    data: { code: "600519", start: "2026-09-01", end: "2026-09-07" },
  });
  const { id } = await created.json();
  await page.request.delete(`/api/research/${id}`);
  await page.goto(`/research/${id}`);
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();
  await page.route(`**/api/research/${id}?*`, (route) => route.abort());
  await page.reload();
  await expect(page.locator(".research-progress [role=alert]")).toContainText(
    "保留上次结果",
  );
  await page.unroute(`**/api/research/${id}?*`);
  await page.getByRole("button", { name: "重新读取" }).click();
  await expect(page.locator(".research-progress [role=alert]")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "重试未完成部分" }),
  ).toBeVisible();
});
