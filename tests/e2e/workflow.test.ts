import { test, expect } from "@playwright/test";

test("import, model extraction, association and revocation preserve conclusion history", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/import");
  await page.getByLabel("新来源", { exact: true }).check();
  await page.getByLabel("来源名称", { exact: true }).fill("浏览器验收公告");
  await page.getByLabel("来源类型（决定等级）").selectOption("issuer");
  await page.getByLabel("标题", { exact: true }).fill("浏览器验收投资项目");
  await page.getByRole("textbox", { name: /正文（/ }).fill("公司公告：董事会已批准投资建设新工厂。");
  await page.getByRole("button", { name: "保存并分析" }).click();
  await expect(page.getByRole("heading", { name: "论断（1）" })).toBeVisible();
  await page.getByLabel("理由", { exact: true }).fill("公告明确披露批准投资事项");
  await page.getByRole("button", { name: "确认关联 1 条论断并重算" }).click();
  await page.getByRole("link", { name: "查看事件" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("浏览器验收投资项目");
  const eventId = new URL(page.url()).pathname.split("/").at(-1);
  const before = await (await page.request.get(`/api/events/${eventId}`)).json();
  expect(before.conclusion.status).toBe("supported");
  expect(before.event.event_type).toBe("investment");
  expect(before.evidence.filter((e: { revokedAt: string | null }) => !e.revokedAt)).toHaveLength(1);
  await page.getByRole("link", { name: "回看此时" }).click();
  await expect(page).toHaveURL(/asOf=/);
  const historic = await (await page.request.get(`/api/events/${eventId}${new URL(page.url()).search}`)).json();
  expect(historic.conclusion.status).toBe("supported");
  expect(historic.isHistorical).toBe(true);
  await page.getByRole("link", { name: "回到当前" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("li.node > details > summary").click();
  await page.getByRole("button", { name: "撤销关联" }).click();
  await expect(page.getByText("已撤销", { exact: true })).toBeVisible();
  const after = await (await page.request.get(`/api/events/${eventId}`)).json();
  expect(after.conclusion.status).toBe("unverified");
  expect(after.evidence[0].revokedAt).toBeTruthy();
  expect(after.history.length).toBeGreaterThan(before.history.length);
  expect(errors).toEqual([]);
});

test("sources pending link exposes analysis and retains analyzed documents for merging", async ({ page }) => {
  const imported = await page.request.post("/api/documents", { data: {
    source: { name: "待分析入口验收", kind: "media" },
    title: "待分析入口资料",
    body: "媒体报道：公司宣布新增生产线。",
  } });
  expect(imported.status()).toBe(201);
  const { documentId } = await imported.json();
  await page.goto("/sources");
  await page.locator(`a[href="/import?doc=${documentId}"]`).click();
  await expect(page.getByText("正在处理已收录资料。")).toBeVisible();
  await expect(page.getByText("内容与已收录版本相同，未新增记录。")).toHaveCount(0);
  await page.getByRole("button", { name: "开始分析", exact: true }).click();
  await expect(page.getByRole("heading", { name: "论断（1）" })).toBeVisible();
  await page.goto("/sources");
  await expect(page.locator(`a[href="/import?doc=${documentId}"]`)).toBeVisible();
});

test("sources batch controls reject missing token and analyze with admin token", async ({ page }) => {
  await page.request.post("/api/documents", { data: {
    source: { name: "批量入口验收", kind: "media" }, title: "批量入口资料", body: "公司公布本年度研究计划。",
  } });
  await page.goto("/sources");
  await page.getByRole("button", { name: /批量分析待处理/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "请先填写管理口令" })).toBeVisible();
  await page.getByLabel(/管理口令.*分析/).fill("e2e-admin");
  await page.getByRole("button", { name: /批量分析待处理/ }).click();
  await expect(page.getByRole("status")).toContainText("批量分析完成");
});
