import { spawn } from "node:child_process";
import { setTimeout } from "node:timers/promises";

const minutes = Number(process.env.SYNC_INTERVAL_MINUTES || 30);
if (!Number.isFinite(minutes) || minutes < 1) {
  throw new Error("SYNC_INTERVAL_MINUTES must be at least 1");
}
const stop = new AbortController();
let child;
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    stop.abort();
    child?.kill(signal);
  });
}
while (!stop.signal.aborted) {
  const code = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, ["--import", "tsx", "scripts/sync.ts"], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  child = undefined;
  if (code !== 0) console.error(`[sync-loop] Sync exited with code ${code}; will retry next interval.`);
  try {
    await setTimeout(minutes * 60_000, undefined, { signal: stop.signal });
  } catch (error) {
    if (error.name !== "AbortError") throw error;
  }
}
