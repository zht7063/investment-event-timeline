#!/usr/bin/env bash
# One-time deploy on this Alibaba Cloud server.
# Run with: sudo bash deploy/setup.sh
set -euo pipefail

PROJ=/home/zht/projects/investment-event-timeline

echo "==> Backing up database"
[ -f "$PROJ/data/app.db" ] && cp "$PROJ/data/app.db" "$PROJ/data/app.db.bak.$(date +%Y%m%d-%H%M%S)" || true

echo "==> Building"
cd "$PROJ"
sudo -u zht /home/zht/.local/bin/npm run build

echo "==> Installing systemd service"
cp deploy/evt-timeline.service /etc/systemd/system/evt-timeline.service
systemctl daemon-reload
systemctl enable evt-timeline
systemctl restart evt-timeline

echo "==> Installing cron (sync every 30 min)"
CRON_LINE="*/30 * * * * cd $PROJ && /home/zht/.local/bin/npx tsx scripts/sync.ts >> /tmp/evt-sync.log 2>&1"
( crontab -u zht -l 2>/dev/null | grep -v 'scripts/sync.ts'; echo "$CRON_LINE" ) | crontab -u zht -

echo "==> Checking service"
sleep 2
systemctl is-active evt-timeline && echo "Service is running" || echo "WARN: Service not active; check journalctl -u evt-timeline"

echo "==> Done. App should be at http://$(hostname -I | awk '{print $1}'):3000"
