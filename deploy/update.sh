#!/usr/bin/env bash
# עדכון לגרסה האחרונה מ-GitHub:  bash /opt/osek/app/deploy/update.sh
set -euo pipefail
BASE=/opt/osek; APP=$BASE/app
sudo -u osek git -C $APP pull --ff-only
cd $APP && sudo -u osek env PATH=$BASE/node/bin:$PATH PUPPETEER_CACHE_DIR=$BASE/.cache/puppeteer npm ci --omit=dev --no-audit --no-fund
sudo -u osek env PATH=$BASE/node/bin:$PATH PUPPETEER_CACHE_DIR=$BASE/.cache/puppeteer $APP/node_modules/.bin/puppeteer browsers install chrome >/dev/null
PORT=$(grep -E '^PORT=' /etc/osek/osek.env | cut -d= -f2)
systemctl restart osek && sleep 3 && [ "$(curl -fsS http://127.0.0.1:$PORT/healthz)" = "ok" ] && echo "✓ עודכן"
