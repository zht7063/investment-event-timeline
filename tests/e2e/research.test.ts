import { test, expect } from "@playwright/test";

test("research validates fields and supports keyboard entry at mobile width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/research");
  await page.getByRole("button", { name: "开始研究", exact: true }).click();
  await expect(page.getByLabel("股票代码", { exact: true })).toBeFocused();
  await expect(page.locator("#code-error")).toContainText("六位");
  await page.getByLabel("股票代码", { exact: true }).fill("600519");
  await page.getByLabel("起始披露日期").fill("2026-09-07");
  await page.getByLabel("截止披露日期").fill("2026-09-01");
  await page.getByRole("button", { name: "开始研究", exact: true }).click();
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
  await page.getByRole("button", { name: "开始研究", exact: true }).click();
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
  // Refresh after rows exist, so SSR must serialize SQLite-backed client props.
  await page.reload();
  await expect(page.getByText("部分完成", { exact: true })).toBeVisible();
  await page.getByText("查看 2 条证据与时间线", { exact: true }).click();
  await expect(page.locator(".research-evidence blockquote")).toHaveCount(2);
  await page.screenshot({
    path: test.info().outputPath("research-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: test.info().outputPath("research-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  // A shared or edited URL can point beyond the available documents.
  // Even a one-page result must offer recovery, including very large offsets.
  for (const offset of [1, 20, 200]) {
    await page.goto(`/research/${id}?offset=${offset}`);
    const documents = page.locator("#research-documents");
    await expect(documents.locator(".research-document")).toHaveCount(offset === 1 ? 1 : 0);
    await expect(documents.locator(".count")).toHaveText(offset === 1 ? "共 2 份，当前 2–2" : "共 2 份，当前 0–0");
    if (offset > 1) await expect(documents.getByText("当前页没有资料，请返回上一页。")).toBeVisible();
    if (offset === 20) await documents.screenshot({ path: test.info().outputPath("documents-out-of-range.png") });
    await documents.getByRole("button", { name: "上一页", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/research/${id}\\?offset=0$`));
    await expect(documents.locator(".research-document")).toHaveCount(2);
    await expect(documents.locator(".count")).toHaveText("共 2 份，当前 1–2");
    await expect(page.getByRole("navigation", { name: "资料分页" })).toHaveCount(0);
  }
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

test("home research can be reopened from records after leaving and date presets stay inclusive", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("从一只股票");
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "股票研究" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "近 90 日", exact: true }).click();
  const start = await page.getByLabel("起始披露日期").inputValue();
  const end = await page.getByLabel("截止披露日期").inputValue();
  expect((Date.parse(end) - Date.parse(start)) / 86400000).toBe(89);
  const created = await page.request.post("/api/research", {
    data: { code: "600519", start: "2026-09-01", end: "2026-09-07" },
  });
  const { id } = await created.json();
  await page.request.delete(`/api/research/${id}`);
  await page.getByRole("button", { name: "刷新记录", exact: true }).click();
  await expect(page.locator(`.research-history a[href='/research/${id}']`)).toBeVisible();
  await expect(page.getByLabel("起始披露日期")).toHaveValue(start);
  await page.goto(`/research/${id}`);
  await expect(page.locator("#research-coverage details")).not.toHaveAttribute("open", "");
  await expect(page.getByRole("navigation", { name: "资料分页" })).toHaveCount(0);
  await page.getByRole("link", { name: "返回研究记录", exact: true }).click();
  await expect(page.locator(`.research-history a[href='/research/${id}']`)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("workspace-desktop.png"), fullPage: true, animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: test.info().outputPath("workspace-mobile.png"), fullPage: true, animations: "disabled" });
  for (const link of await page.getByRole("navigation", { name: "主导航" }).getByRole("link").all()) {
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator(`.research-history a[href='/research/${id}']`).click();
  await expect(page).toHaveURL(new RegExp(`/research/${id}$`));
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "事件库", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("每个判断");
});
