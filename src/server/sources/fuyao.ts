/**
 * Fuyao financial data connector.
 * - a-share MCP: ticker search, price snapshots (background only, not evidence)
 * - REST news: stock timeline list (for evidence sync, since MCP news returns 405)
 * Auth: X-api-key header with FUYAO_API_KEY.
 */
import { fetchWithPolicy, HttpError } from "../http";

function env() {
  const key = process.env.FUYAO_API_KEY?.trim();
  const base = process.env.FUYAO_BASE_URL?.trim();
  const mcpAShare = process.env.FUYAO_MCP_A_SHARE_URL?.trim();
  const mcpMeta = process.env.FUYAO_MCP_META_URL?.trim();
  return { key, base, mcpAShare, mcpMeta };
}

export function isConfigured(): boolean {
  const { key, mcpAShare } = env();
  return Boolean(key && mcpAShare);
}

/** MCP Streamable HTTP: initialize -> notifications/initialized -> tools/call. */
async function mcpCall(
  mcpUrl: string,
  apiKey: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": apiKey,
  };
  const initBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "evt-timeline", version: "0.1.0" } } });
  const { res: initRes } = await fetchWithPolicy(mcpUrl, { method: "POST", headers, body: initBody });
  const initText = await initRes.text();
  const sessionId = initRes.headers.get("mcp-session-id");
  const sessHeaders = sessionId ? { ...headers, "mcp-session-id": sessionId } : headers;

  // Notify initialized
  await fetchWithPolicy(mcpUrl, {
    method: "POST",
    headers: sessHeaders,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }).catch(() => {});

  const callBody = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: tool, arguments: args } });
  const { res: callRes } = await fetchWithPolicy(mcpUrl, { method: "POST", headers: sessHeaders, body: callBody });
  const callText = await callRes.text();
  return parseMcpResponse(callText);
}

function parseMcpResponse(text: string): unknown {
  if (text.includes("data:")) {
    const lines = text.split("\n").filter((l) => l.startsWith("data:"));
    for (const line of lines.reverse()) {
      try {
        const obj = JSON.parse(line.slice(5).trim());
        if (obj.result) return obj.result;
        if (obj.error) throw new Error(obj.error.message ?? JSON.stringify(obj.error));
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
  try {
    const obj = JSON.parse(text);
    if (obj.result) return obj.result;
    if (obj.error) throw new Error(obj.error.message ?? JSON.stringify(obj.error));
    return obj;
  } catch {
    throw new Error("Fuyao: cannot parse MCP response");
  }
}

export type PriceSnapshot = {
  code: string;
  name: string;
  lastPrice: number | null;
  changeRatioPct: number | null;
  turnover: number | null;
  timestamp: string | null;
};

/** A-share price snapshot for one or more tickers (background only, not evidence). */
export async function getPriceSnapshot(thscodes: string[]): Promise<PriceSnapshot[]> {
  const { key, mcpAShare } = env();
  if (!key || !mcpAShare) throw new Error("FUYAO_API_KEY or FUYAO_MCP_A_SHARE_URL not configured");
  const result = await mcpCall(mcpAShare, key, "get_a_share_prices_snapshot", { thscodes: thscodes.join(",") }) as {
    content?: { type: string; text: string }[];
  };
  const text = result?.content?.find((c: { type: string }) => c.type === "text")?.text;
  if (!text) return [];
  try {
    const data = JSON.parse(text);
    const rows = Array.isArray(data) ? data : data.data ? (Array.isArray(data.data) ? data.data : [data.data]) : [data];
    return rows.map((r: Record<string, unknown>) => ({
      code: String(r.thscode ?? r.code ?? ""),
      name: String(r.name ?? r.stock_name ?? ""),
      lastPrice: typeof r.last_price === "number" ? r.last_price : null,
      changeRatioPct: typeof r.price_change_ratio_pct === "number" ? r.price_change_ratio_pct : null,
      turnover: typeof r.turnover === "number" ? r.turnover : null,
      timestamp: r.timestamp ? new Date(Number(r.timestamp)).toISOString() : null,
    }));
  } catch {
    return [];
  }
}

export type FuyaoNewsItem = {
  title: string;
  content: string;
  date: string;
  url: string | null;
};

/** REST news timeline for a stock (fallback since MCP news returns 405). */
export async function getNewsTimeline(thscode: string, limit = 20): Promise<FuyaoNewsItem[]> {
  const { key, base } = env();
  if (!key || !base) throw new Error("FUYAO_API_KEY or FUYAO_BASE_URL not configured");
  const url = `${base.replace(/\/+$/, "")}/api/news/stock/timeline-list?thscode=${encodeURIComponent(thscode)}&limit=${limit}`;
  try {
    const { res } = await fetchWithPolicy(url, { method: "GET", headers: { "x-api-key": key } });
    const json = await res.json() as { data?: unknown[] };
    const items = Array.isArray(json.data) ? json.data : [];
    return items.map((item) => { const r = item as Record<string, unknown>; return {
      title: String(r.title ?? r.news_title ?? ""),
      content: String(r.content ?? r.news_content ?? ""),
      date: String(r.date ?? r.published_at ?? ""),
      url: typeof r.url === "string" ? r.url : null,
    }; });
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new Error(`Fuyao news request failed: ${(e as Error).message}`);
  }
}
