import { createHash } from "node:crypto";
import {
  beijingDay,
  type Instrument,
  type SourceId,
  type Window,
} from "@/domain/research";
import { parseTime } from "@/domain/time";
import { fetchWithPolicy } from "../http";
import { callMcp, toolPayload } from "../sources/mcp";

export type ResearchItem = {
  key: string;
  title: string;
  body: string;
  url: string | null;
  publishedAt: string | null;
  publisher: string;
  contentKind: "snippet" | "summary";
  sourceId: SourceId;
};
export type Page = {
  items: ResearchItem[];
  next: string | null;
  exhausted: boolean;
  rawCount: number;
  invalid: number;
};
const env = (key: string) => process.env[key]?.trim() || "";
export function configured(source: SourceId) {
  return source.startsWith("ifind")
    ? Boolean(env("IFIND_TOKEN") && env("IFIND_MCP_URL"))
    : Boolean(env("FUYAO_API_KEY") && env("FUYAO_BASE_URL"));
}
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
const str = (v: unknown) => (typeof v === "string" ? v : "");
const safeUrl = (v: unknown) => {
  try {
    const u = new URL(str(v));
    return ["https:", "http:"].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
};
export function publishedDay(value: string | null): string | null {
  try {
    const parsed = parseTime(value);
    return parsed && ["day", "datetime"].includes(parsed.precision)
      ? beijingDay(new Date(parsed.iso))
      : null;
  } catch {
    return null;
  }
}

export async function resolveInstrument(query: string): Promise<Instrument> {
  if (!env("FUYAO_API_KEY") || !env("FUYAO_MCP_META_URL"))
    throw new Error("标的检索未配置：需要扶摇 Key 和 META 端点");
  const result = await callMcp(
    env("FUYAO_MCP_META_URL"),
    { "x-api-key": env("FUYAO_API_KEY") },
    "tools/call",
    {
      name: "get_meta_tickers_search",
      arguments: { q: query, asset_type: "a-share", limit: 50 },
    },
  );
  const payload = toolPayload(result) as {
    code: number;
    data?: { item?: Record<string, unknown>[] };
  };
  if (payload.code !== 0 || !Array.isArray(payload.data?.item))
    throw new Error("标的检索返回异常");
  const rows = payload.data.item.filter(
    (r) =>
      /^\d{6}\.(SH|SZ|BJ)$/.test(str(r.thscode)) &&
      (str(r.thscode) === query || str(r.ticker) === query),
  );
  if (rows.length !== 1 || !str(rows[0].name))
    throw new Error("未找到唯一 A 股标的，请检查代码或补全交易所后缀");
  return { code: str(rows[0].thscode), name: str(rows[0].name) };
}

/** The provider has a documented success code of 1, unlike Fuyao's code 0. */
export function parseIfindRows(raw: unknown): Record<string, unknown>[] {
  let value = raw;
  for (let depth = 0; depth < 8; depth++) {
    if (typeof value === "string") {
      if (
        value.startsWith("# 查询结果") &&
        value.includes("本次新闻搜索结果为空")
      )
        return [];
      try {
        value = JSON.parse(value);
        continue;
      } catch {
        throw new Error("iFinD 返回未知文本，不能视为零结果");
      }
    }
    if (Array.isArray(value))
      return value.filter((r) => r && typeof r === "object");
    if (value && typeof value === "object") {
      const r = value as Record<string, unknown>;
      if ("code" in r && r.code !== 1) throw new Error("iFinD 业务调用失败");
      if ("data" in r) {
        value = r.data;
        continue;
      }
    }
    throw new Error("iFinD 响应结构不符合预期");
  }
  throw new Error("iFinD 响应嵌套过深");
}

export async function fetchIfind(
  sourceId: "ifind-notice" | "ifind-news",
  instrument: Instrument,
  window: Window,
): Promise<Page> {
  const notice = sourceId === "ifind-notice";
  const result = await callMcp(
    env("IFIND_MCP_URL"),
    { authorization: env("IFIND_TOKEN") },
    "tools/call",
    {
      name: notice ? "search_notice" : "search_news",
      arguments: {
        query: `${instrument.name} ${instrument.code}`,
        time_start: window.start,
        time_end: window.end,
        size: 20,
      },
    },
  );
  const rows = parseIfindRows(toolPayload(result));
  const items: ResearchItem[] = [];
  for (const r of rows) {
    const title = str(r[notice ? "公告标题" : "资讯标题"] ?? r.title);
    const body = str(
      r[notice ? "公告片段内容" : "资讯内容"] ?? r.content ?? r.snippet,
    );
    if (!title || !body) continue;
    const publishedAt = str(r["日期"] ?? r.date) || null;
    const url = safeUrl(r.URL ?? r.url);
    // Preserve separate semantic fragments. They are not successive full-text document versions.
    const identity = digest(
      `${instrument.code}|${title}|${publishedAt}|${body}`,
    );
    items.push({
      key: `${sourceId}:${identity}`,
      title,
      body,
      publishedAt,
      url,
      publisher:
        sourceId === "ifind-notice"
          ? "公司公告（iFinD 收录片段）"
          : "iFinD 新闻片段",
      contentKind: "snippet",
      sourceId,
    });
  }
  return {
    items,
    next: null,
    exhausted: false,
    rawCount: items.length,
    invalid: rows.length - items.length,
  };
}

export async function fetchFuyao(
  instrument: Instrument,
  cursor: string,
): Promise<Page> {
  const url = new URL(
    `${env("FUYAO_BASE_URL").replace(/\/+$/, "")}/api/news/stock/timeline-list`,
  );
  url.searchParams.set("thscode", instrument.code);
  url.searchParams.set("offset", cursor);
  const { res } = await fetchWithPolicy(url.href, {
    headers: { "x-api-key": env("FUYAO_API_KEY") },
  });
  const payload = (await res.json()) as {
    code: number;
    data?: {
      items: Record<string, unknown>[];
      has_more: boolean;
      offset: string;
    };
  };
  const data = payload.data;
  if (
    payload.code !== 0 ||
    !data ||
    !Array.isArray(data.items) ||
    typeof data.has_more !== "boolean"
  )
    throw new Error("扶摇业务错误或分页结构异常");
  if (data.has_more && (typeof data.offset !== "string" || !data.offset))
    throw new Error("扶摇缺少下一页游标");
  const items: ResearchItem[] = [];
  for (const r of data.items) {
    const title = str(r.title),
      body = str(r.content ?? r.summary);
    if (!title || !body) continue;
    const time = Number(r.publish_time_ms);
    const publishedAt =
      Number.isFinite(time) && time > 0 ? new Date(time).toISOString() : null;
    const url = safeUrl(r.jump_url);
    items.push({
      key: `fuyao:${str(r.id) || digest(`${title}|${publishedAt}`)}`,
      title,
      body,
      url,
      publishedAt,
      publisher: str(r.source) || "扶摇新闻",
      contentKind: "summary",
      sourceId: "fuyao-news",
    });
  }
  return {
    items,
    next: data.has_more ? data.offset : null,
    exhausted: !data.has_more,
    rawCount: data.items.length,
    invalid: data.items.length - items.length,
  };
}

export const fetchPage = (
  source: SourceId,
  instrument: Instrument,
  window: Window,
  cursor: string,
) =>
  source === "fuyao-news"
    ? fetchFuyao(instrument, cursor)
    : fetchIfind(source, instrument, window);
