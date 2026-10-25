/**
 * iFinD MCP connector for notice and news search.
 * Auth: Authorization header with IFIND_TOKEN.
 * Results are snippets (no full text); date is day-precision only.
 */
import { fetchWithPolicy, HttpError } from "../http";

function env() {
  const token = process.env.IFIND_TOKEN?.trim();
  const mcpUrl = process.env.IFIND_MCP_URL?.trim();
  return { token, mcpUrl };
}

export function isConfigured(): boolean {
  const { token, mcpUrl } = env();
  return Boolean(token && mcpUrl);
}

async function mcpCall(
  mcpUrl: string,
  token: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: token,
  };
  // Initialize
  const initBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "evt-timeline", version: "0.1.0" } } });
  const { res: initRes } = await fetchWithPolicy(mcpUrl, { method: "POST", headers, body: initBody });
  await initRes.text();
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
    throw new Error("iFinD: cannot parse MCP response");
  }
}

export type NoticeItem = {
  title: string;
  snippet: string;
  date: string;
};

export type NewsItem = {
  title: string;
  snippet: string;
  date: string;
  url: string | null;
};

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse iFinD content field which may be double-JSON-encoded. */
function parseContent(raw: unknown): Record<string, unknown>[] {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      if (parsed.data) {
        const inner = typeof parsed.data === "string" ? JSON.parse(parsed.data) : parsed.data;
        return Array.isArray(inner) ? inner : [inner];
      }
      return [parsed];
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw;
  return [];
}

function extractTextContent(result: unknown): string {
  const r = result as { content?: { type: string; text: string }[] };
  return r?.content?.find((c) => c.type === "text")?.text ?? "";
}

/** Search notices (announcements) via iFinD MCP. */
export async function searchNotice(query: string, days = 30, size = 10): Promise<NoticeItem[]> {
  const { token, mcpUrl } = env();
  if (!token || !mcpUrl) throw new Error("IFIND_TOKEN or IFIND_MCP_URL not configured");
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  const result = await mcpCall(mcpUrl, token, "search_notice", {
    query,
    time_start: toYMD(start),
    time_end: toYMD(end),
    size,
  });
  const text = extractTextContent(result);
  const items = parseContent(text);
  return items.map((r) => ({
    title: String(r["\u516C\u544A\u6807\u9898"] ?? r.title ?? ""),
    snippet: String(r["\u516C\u544A\u7247\u6BB5\u5185\u5BB9"] ?? r.snippet ?? r.content ?? ""),
    date: String(r["\u65E5\u671F"] ?? r.date ?? ""),
  }));
}

/** Search news via iFinD MCP. */
export async function searchNews(query: string, days = 30, size = 10): Promise<NewsItem[]> {
  const { token, mcpUrl } = env();
  if (!token || !mcpUrl) throw new Error("IFIND_TOKEN or IFIND_MCP_URL not configured");
  const end = new Date();
  const start = new Date(end.getTime() - days * 86400_000);
  const result = await mcpCall(mcpUrl, token, "search_news", {
    query,
    time_start: toYMD(start),
    time_end: toYMD(end),
    size,
  });
  const text = extractTextContent(result);
  const items = parseContent(text);
  return items.map((r) => ({
    title: String(r["\u8D44\u8BAF\u6807\u9898"] ?? r.title ?? ""),
    snippet: String(r["\u8D44\u8BAF\u5185\u5BB9"] ?? r.content ?? ""),
    date: String(r["\u65E5\u671F"] ?? r.date ?? ""),
    url: typeof r.URL === "string" ? r.URL : typeof r.url === "string" ? r.url : null,
  }));
}
