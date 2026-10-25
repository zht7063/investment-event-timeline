import { describe, expect, it } from "vitest";
import { fetchWithPolicy, HttpError, retryAfterMs } from "@/server/http";

const seq = (responses: (Response | Error)[]) => {
  let i = 0;
  const calls: number[] = [];
  const fetchImpl = (async () => {
    calls.push(i);
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
};
const res = (status: number, headers: Record<string, string> = {}) => new Response("{}", { status, headers });

describe("fetchWithPolicy", () => {
  it("429 waits each Retry-After, retries at most 3 times, then RATE_LIMITED", async () => {
    const waits: number[] = [];
    const { fetchImpl, calls } = seq([res(429, { "retry-after": "2" }), res(429, { "retry-after": "5" }), res(429, { "retry-after": "1" }), res(429, { "retry-after": "9" })]);
    const err = await fetchWithPolicy("x", {}, { fetchImpl, sleep: async (ms) => void waits.push(ms) }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.code).toBe("RATE_LIMITED");
    expect(waits).toEqual([2000, 5000, 1000]);
    expect(calls).toHaveLength(4);
    expect(err.attempts.map((a: { status: number }) => a.status)).toEqual([429, 429, 429, 429]);
  });

  it("429 then success returns the response", async () => {
    const { fetchImpl } = seq([res(429, { "retry-after": "0" }), res(200)]);
    const r = await fetchWithPolicy("x", {}, { fetchImpl, sleep: async () => {} });
    expect(r.res.status).toBe(200);
    expect(r.attempts).toHaveLength(2);
  });

  it("5xx backs off 1s, 2s and gives up after 2 retries", async () => {
    const waits: number[] = [];
    const { fetchImpl, calls } = seq([res(502), res(503), res(500)]);
    const err = await fetchWithPolicy("x", {}, { fetchImpl, sleep: async (ms) => void waits.push(ms) }).catch((e) => e);
    expect(err.code).toBe("UPSTREAM_UNAVAILABLE");
    expect(waits).toEqual([1000, 2000]);
    expect(calls).toHaveLength(3);
  });

  it("timeouts count as transient", async () => {
    const t = Object.assign(new Error("t"), { name: "TimeoutError" });
    const { fetchImpl } = seq([t, t, t]);
    const err = await fetchWithPolicy("x", {}, { fetchImpl, sleep: async () => {} }).catch((e) => e);
    expect(err.code).toBe("TIMEOUT");
  });

  it.each([
    [400, "BAD_REQUEST"],
    [401, "AUTH_FAILED"],
    [403, "AUTH_FAILED"],
  ])("%i is not retried", async (status, code) => {
    const { fetchImpl, calls } = seq([res(status), res(200)]);
    const err = await fetchWithPolicy("x", {}, { fetchImpl, sleep: async () => {} }).catch((e) => e);
    expect(err.code).toBe(code);
    expect(calls).toHaveLength(1);
  });

  it("parses Retry-After seconds and dates", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(retryAfterMs(null)).toBe(1000);
  });
});
