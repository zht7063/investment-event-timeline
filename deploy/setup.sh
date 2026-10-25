#!/usr/bin/env bash
# Run as the service owner: bash deploy/setup.sh [project-directory]
set -euo pipefail

PROJECT_DIR="$(cd "${1:-$(dirname "$0")/..}" && pwd)"
NODE_BIN="$(command -v node)"
PORT="${PORT:-3000}"
BIND_HOST="${BIND_HOST:-0.0.0.0}"
SYNC_INTERVAL_MINUTES="${SYNC_INTERVAL_MINUTES:-30}"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

if [[ "$PROJECT_DIR" =~ [[:space:]%] || "$NODE_BIN" =~ [[:space:]%] ]]; then
  echo "Project and Node paths must not contain whitespace or percent signs." >&2
  exit 1
fi
[[ "$PORT" =~ ^[0-9]+$ && "$PORT" -ge 1 && "$PORT" -le 65535 ]]
[[ "$SYNC_INTERVAL_MINUTES" =~ ^[0-9]+$ && "$SYNC_INTERVAL_MINUTES" -ge 1 ]]
[[ "$BIND_HOST" =~ ^[a-zA-Z0-9.:_-]+$ ]]
[[ -f "$PROJECT_DIR/.env" ]]
"$NODE_BIN" -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)'
systemctl --user show-environment >/dev/null
if command -v crontab >/dev/null && crontab -l 2>/dev/null | grep -F "$PROJECT_DIR" | grep -Eq 'npm run sync|scripts/sync.ts'; then
  echo "Existing sync cron entry found. Remove that entry before switching to the systemd timer." >&2
  exit 1
fi

cd "$PROJECT_DIR"
mkdir -p data
chmod 600 .env
npm run backup
npm run build
mkdir -p "$UNIT_DIR"

export PROJECT_DIR NODE_BIN PORT BIND_HOST UNIT_DIR SYNC_INTERVAL_MINUTES
"$NODE_BIN" --input-type=module <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const env = process.env;
const render = (name) => readFileSync(join("deploy", name), "utf8")
  .replace(/@([A-Z_]+)@/g, (_, key) => env[key]);
for (const name of ["evt-timeline.service", "evt-timeline-sync.service", "evt-timeline-sync.timer"]) {
  writeFileSync(join(env.UNIT_DIR, name), render(name), { mode: 0o600 });
}
NODE

systemctl --user daemon-reload
systemctl --user enable evt-timeline.service
systemctl --user restart evt-timeline.service
systemctl --user enable --now evt-timeline-sync.timer

"$NODE_BIN" --input-type=module <<'NODE'
import { setTimeout } from "node:timers/promises";
const host = process.env.BIND_HOST === "0.0.0.0" ? "127.0.0.1"
  : process.env.BIND_HOST === "::" ? "[::1]" : process.env.BIND_HOST;
for (let attempt = 0; attempt < 20; attempt++) {
  try {
    const response = await fetch(`http://${host}:${process.env.PORT}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (response.ok && (await response.json()).ok) process.exit(0);
  } catch {}
  await setTimeout(1000);
}
console.error("Health check failed; inspect journalctl --user -u evt-timeline.");
process.exit(1);
NODE
echo "Service and sync timer installed. Enable user linger for service after logout."
echo "If upgrading from cron, remove only the old evt-timeline sync cron entry."
