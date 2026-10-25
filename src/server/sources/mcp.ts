import { fetchWithPolicy } from "../http";

/** Read both JSON and SSE JSON-RPC envelopes; do not confuse tool failures with empty data. */
export function parseRpc(text: string): Record<string, unknown> {
  const payloads = text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());
  for (const raw of payloads.length ? payloads.reverse() : [text]) {
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      continue;
    }
    if (obj.error) throw new Error("数据源 RPC 调用失败");
    if (obj.result) {
      if (obj.result.isError) throw new Error("数据源工具返回错误");
      return obj.result;
    }
  }
  throw new Error("数据源返回格式无法识别");
}

export async function callMcp(
  url: string,
  auth: Record<string, string>,
  method: string,
  params: object,
): Promise<Record<string, unknown>> {
  const headers = {
    ...auth,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  const send = async (body: object) =>
    fetchWithPolicy(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  const init = await send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "evt-research", version: "1" },
    },
  });
  parseRpc(await init.res.text());
  const session = init.res.headers.get("mcp-session-id");
  if (session) Object.assign(headers, { "mcp-session-id": session });
  const ready = await send({
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
  await ready.res.text();
  const response = await send({ jsonrpc: "2.0", id: 2, method, params });
  return parseRpc(await response.res.text());
}

export function toolPayload(result: Record<string, unknown>): unknown {
  if (result.structuredContent) return result.structuredContent;
  const contents = result.content as
    { type: string; text?: string }[] | undefined;
  const text = contents?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("数据源缺少有效内容");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("数据源内容不是有效 JSON");
  }
}
