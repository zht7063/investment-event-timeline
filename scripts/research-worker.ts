import { setTimeout } from "node:timers/promises";
import { workOnce } from "../src/server/research/worker";
const stop = new AbortController();
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => stop.abort());
console.log("[research-worker] started");
while (!stop.signal.aborted) {
  try {
    const didWork = await workOnce();
    await setTimeout(didWork ? 100 : 1500, undefined, { signal: stop.signal });
  } catch (error) {
    if (stop.signal.aborted) break;
    console.error(
      "[research-worker] step failed; retrying",
      error instanceof Error ? error.name : "UnknownError",
    );
    try {
      await setTimeout(5000, undefined, { signal: stop.signal });
    } catch {
      break;
    }
  }
}
console.log("[research-worker] stopped");
