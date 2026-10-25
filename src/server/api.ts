import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { IngestError } from "./ingest";

export const MAX_BODY_CHARS = 20_000;

/** Stable error envelope: code + message, never stacks or credentials. */
export const fail = (status: number, code: string, message: string, extra?: object) => Response.json({ error: { code, message, ...extra } }, { status });

/** Read JSON with a hard size cap (raw length leaves room for metadata around a 20k-char body). */
export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  const text = await req.text();
  if (text.length > MAX_BODY_CHARS * 2 + 4_000) return { ok: false, res: fail(413, "PAYLOAD_TOO_LARGE", `请求过大，正文上限 ${MAX_BODY_CHARS} 字`) };
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, res: fail(400, "INVALID_JSON", "请求体不是合法 JSON") };
  }
  const p = schema.safeParse(raw);
  if (!p.success) {
    return { ok: false, res: fail(400, "VALIDATION_FAILED", "参数校验失败", { issues: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }) };
  }
  return { ok: true, data: p.data };
}

const STATUS_OF = { NOT_FOUND: 404, INVALID: 400, CONFLICT: 409 } as const;

export function handleError(e: unknown): Response {
  if (e instanceof IngestError) return fail(STATUS_OF[e.code], e.code, e.message);
  console.error(e);
  return fail(500, "INTERNAL", "服务器内部错误");
}

/** ADMIN_TOKEN gate for sync/reset. Unset token means the action is disabled, not open. */
export function requireAdmin(req: Request): Response | null {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return fail(503, "ADMIN_NOT_CONFIGURED", "未配置 ADMIN_TOKEN，管理操作不可用");
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return fail(401, "UNAUTHORIZED", "管理口令无效");
  return null;
}
