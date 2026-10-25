/**
 * Outbound call policy shared by the model and data providers (plan section 6):
 * - 429: wait each Retry-After, at most 3 retries, then stop with RATE_LIMITED.
 * - 5xx / timeout / network: wait 1s then 2s, at most 2 retries.
 * - other 4xx: no retry.
 * Every attempt is recorded with status and duration.
 */
export type Attempt = { status: number | "timeout" | "network"; ms: number };

export type HttpErrorCode = "RATE_LIMITED" | "UPSTREAM_UNAVAILABLE" | "TIMEOUT" | "BAD_REQUEST" | "AUTH_FAILED" | "UPSTREAM_ERROR";

export class HttpError extends Error {
  constructor(
    public code: HttpErrorCode,
    message: string,
    public attempts: Attempt[],
    public status?: number,
  ) {
    super(message);
  }
}

type Opts = { timeoutMs?: number; sleep?: (ms: number) => Promise<void>; fetchImpl?: typeof fetch };

const MAX_429_RETRIES = 3;
const BACKOFF_5XX = [1000, 2000];

/** Retry-After as seconds or HTTP date; missing/invalid falls back to 1s. */
export function retryAfterMs(h: string | null, now = Date.now()): number {
  if (!h) return 1000;
  const s = Number(h);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(h);
  return Number.isNaN(t) ? 1000 : Math.max(0, t - now);
}

export async function fetchWithPolicy(url: string, init: RequestInit, opts: Opts = {}): Promise<{ res: Response; attempts: Attempt[] }> {
  const { timeoutMs = 30_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), fetchImpl = fetch } = opts;
  const attempts: Attempt[] = [];
  let n429 = 0;
  let nTransient = 0;
  for (;;) {
    const start = Date.now();
    let res: Response | null = null;
    let failure: "timeout" | "network" | null = null;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const name = (e as Error).name;
      failure = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
    }
    attempts.push({ status: res ? res.status : failure!, ms: Date.now() - start });

    if (res && res.ok) return { res, attempts };
    if (res && res.status === 429) {
      if (n429 >= MAX_429_RETRIES) throw new HttpError("RATE_LIMITED", `上游限流，已重试 ${MAX_429_RETRIES} 次仍为 429`, attempts, 429);
      n429 += 1;
      await sleep(retryAfterMs(res.headers.get("retry-after")));
      continue;
    }
    if (!res || res.status >= 500) {
      if (nTransient >= BACKOFF_5XX.length) {
        if (failure === "timeout") throw new HttpError("TIMEOUT", "上游超时，已重试 2 次", attempts);
        throw new HttpError("UPSTREAM_UNAVAILABLE", `上游不可用（${res?.status ?? failure}），已重试 2 次`, attempts, res?.status);
      }
      await sleep(BACKOFF_5XX[nTransient++]);
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new HttpError("AUTH_FAILED", `上游认证或权限错误（${res.status}）`, attempts, res.status);
    if (res.status === 400) throw new HttpError("BAD_REQUEST", "上游拒绝请求参数（400）", attempts, 400);
    throw new HttpError("UPSTREAM_ERROR", `上游返回 ${res.status}`, attempts, res.status);
  }
}
