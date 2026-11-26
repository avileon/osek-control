#!/usr/bin/env bash
# התקנה/עדכון של osek-control על שרת Ubuntu קיים (עם Caddy). להרצה כ-root:
#   curl -fsSL https://raw.githubusercontent.com/avileon/osek-control/main/deploy/provision.sh | DOMAIN=osek.atar.co bash
# בטוח להריץ שוב: לא דורס .env קיים ולא נוגע באפליקציות אחרות בשרת.
set -euo pipefail
DOMAIN="${DOMAIN:-osek.atar.co}"
REPO="${REPO:-https://github.com/avileon/osek-control}"
PORT="${PORT:-3100}"
BASE=/opt/osek; APP=$BASE/app; NODE=$BASE/node; DATA=/var/lib/osek; ENVF=/etc/osek/osek.env
export PUPPETEER_CACHE_DIR=$BASE/.cache/puppeteer

[ "$(id -u)" = 0 ] || { echo "להריץ כ-root"; exit 1; }
echo "== osek-control → $DOMAIN (port $PORT)"

# 1. משתמש מערכת ייעודי
id osek >/dev/null 2>&1 || useradd --system --home-dir $BASE --shell /usr/sbin/nologin osek
mkdir -p $BASE $DATA /etc/osek $BASE/.cache
chown osek:osek $BASE $DATA $BASE/.cache; chmod 700 $DATA

# 2. חבילות מערכת (git + ספריות ל-Chrome של הסקרייפרים). שמות שונים ב-22.04/24.04 → מתקינים אחד-אחד.
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq git curl ca-certificates xz-utils fonts-noto-core >/dev/null
for p in libnss3 libatk-bridge2.0-0t64 libatk-bridge2.0-0 libgtk-3-0t64 libgtk-3-0 libxss1 libasound2t64 libasound2 \
         libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libpango-1.0-0 libcairo2 libcups2t64 libcups2 libdrm2 libxshmfence1; do
  apt-get install -y -qq "$p" >/dev/null 2>&1 || true
done

# 3. Node 24 בתיקייה פרטית — לא נוגע ב-Node של אפליקציות אחרות
if ! "$NODE/bin/node" -v 2>/dev/null | grep -q '^v24'; then
  TARBALL=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt | awk '/linux-x64.tar.xz$/{print $2}')
  curl -fsSL "https://nodejs.org/dist/latest-v24.x/$TARBALL" -o /tmp/node.tar.xz
  rm -rf $NODE && mkdir -p $NODE && tar -xJf /tmp/node.tar.xz -C $NODE --strip-components=1 && rm /tmp/node.tar.xz
fi
echo "node $($NODE/bin/node -v)"

# 4. קוד
if [ -d $APP/.git ]; then sudo -u osek git -C $APP pull --ff-only
else sudo -u osek git clone --depth 1 "$REPO" $APP; fi

# 5. תלויות (כולל Chrome של puppeteer לתוך $PUPPETEER_CACHE_DIR)
cd $APP
sudo -u osek env PATH=$NODE/bin:$PATH PUPPETEER_CACHE_DIR=$PUPPETEER_CACHE_DIR npm ci --omit=dev --no-audit --no-fund

# 6. קובץ סביבה — נוצר פעם אחת בלבד
NEWPASS=""
if [ ! -f $ENVF ]; then
  NEWPASS=$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 16)
  cat > $ENVF <<ENV
PORT=$PORT
HOST=127.0.0.1
PUBLIC_URL=https://$DOMAIN
TZ=Asia/Jerusalem
NODE_ENV=production
DB_PATH=$DATA/osek.db
APP_SECRET=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
DASH_USER=avi
DASH_PASS=$NEWPASS
CHROME_NO_SANDBOX=1
PUPPETEER_CACHE_DIR=$PUPPETEER_CACHE_DIR
ENV
fi
chown root:osek $ENVF; chmod 640 $ENVF

# 7. systemd
cat > /etc/systemd/system/osek.service <<UNIT
[Unit]
Description=osek-control
After=network-online.target
Wants=network-online.target

[Service]
User=osek
Group=osek
WorkingDirectory=$APP
EnvironmentFile=$ENVF
ExecStart=$NODE/bin/node --disable-warning=ExperimentalWarning src/server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$DATA $BASE/.cache

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now osek.service
systemctl restart osek.service

# 8. Caddy — מוסיף בלוק לדומיין רק אם אין
if command -v caddy >/dev/null && [ -f /etc/caddy/Caddyfile ]; then
  if ! grep -q "^$DOMAIN" /etc/caddy/Caddyfile; then
    cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%s)
    cat >> /etc/caddy/Caddyfile <<CADDY

$DOMAIN {
	encode gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Frame-Options DENY
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		-Server
	}
	reverse_proxy 127.0.0.1:$PORT
}
CADDY
  fi
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null && systemctl reload caddy
else
  echo "!! Caddy לא נמצא — צריך reverse proxy ל-127.0.0.1:$PORT"
fi

# 9. בדיקה
sleep 4
curl -fsS http://127.0.0.1:$PORT/healthz >/dev/null && echo "✓ osek-control רץ" || { echo "✗ לא עולה:"; journalctl -u osek -n 30 --no-pager; exit 1; }
echo
echo "==================================================="
echo " כתובת:  https://$DOMAIN"
echo " משתמש:  avi"
[ -n "$NEWPASS" ] && echo " סיסמה:  $NEWPASS   ← לרשום עכשיו! (נשמרת ב-$ENVF)"
echo "==================================================="
