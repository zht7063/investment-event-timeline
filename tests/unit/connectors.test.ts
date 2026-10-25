import { afterEach, expect, it, vi } from "vitest";
import { getNewsTimeline, getPriceSnapshot } from "@/server/sources/fuyao";
import { searchNews } from "@/server/sources/ifind";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function mcpResponse(payload: unknown) {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ result: {} }))
    .mockResolvedValueOnce(new Response(null, { status: 202 }))
    .mockResolvedValueOnce(Response.json({ result: { content: [{ type: "text", text: JSON.stringify(payload) }] } }));
  vi.stubGlobal("fetch", fetchMock);
}

it("reads real Fuyao snapshot rows and the shared timestamp", async () => {
  vi.stubEnv("FUYAO_API_KEY", "test");
  vi.stubEnv("FUYAO_MCP_A_SHARE_URL", "https://example.com/mcp");
  mcpResponse({ code: 0, data: { timestamp: 1792915685000, total: 1, item: [{ thscode: "300308.SZ", last_price: 612.63, price_change_ratio_pct: 3.816238, turnover: 27918480000 }] } });
  expect(await getPriceSnapshot(["300308.SZ"])).toEqual([{ code: "300308.SZ", name: "", lastPrice: 612.63, changeRatioPct: 3.816238, turnover: 27918480000, timestamp: new Date(1792915685000).toISOString() }]);
});

it("unwraps iFinD news data.data JSON", async () => {
  vi.stubEnv("IFIND_TOKEN", "test");
  vi.stubEnv("IFIND_MCP_URL", "https://example.com/mcp");
  mcpResponse({ code: 1, data: { data: JSON.stringify([{ 资讯标题: "新闻", 资讯内容: "片段", 日期: "2026-10-24", URL: "https://example.com/news" }]) } });
  expect(await searchNews("300308.SZ")).toEqual([{ title: "新闻", snippet: "片段", date: "2026-10-24", url: "https://example.com/news" }]);
});

it("does not treat a Fuyao HTTP 200 business error as empty success", async () => {
  vi.stubEnv("FUYAO_API_KEY", "test");
  vi.stubEnv("FUYAO_BASE_URL", "https://example.com");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: 1001, message: "Missing required parameter: offset", data: null })));
  await expect(getNewsTimeline("300308.SZ")).rejects.toThrow(/1001.*offset/);
});

it("uses Fuyao first-page cursor and maps items, summary, jump URL and millisecond dates", async () => {
  vi.stubEnv("FUYAO_API_KEY", "test");
  vi.stubEnv("FUYAO_BASE_URL", "https://example.com");
  const fetchMock = vi.fn().mockResolvedValue(Response.json({ code: 0, data: { items: [
    { title: "个股新闻", summary: "新闻摘要", publish_time_ms: 1792914912000, jump_url: "https://example.com/news" },
    { title: "下一条", summary: "下一段" },
  ] } }));
  vi.stubGlobal("fetch", fetchMock);
  expect(await getNewsTimeline("300308.SZ", 1)).toEqual([{ title: "个股新闻", content: "新闻摘要", date: new Date(1792914912000).toISOString(), url: "https://example.com/news" }]);
  const url = new URL(fetchMock.mock.calls[0][0]);
  expect(url.searchParams.get("offset")).toBe("first");
  expect(url.searchParams.has("limit")).toBe(false);
});
