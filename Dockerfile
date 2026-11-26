FROM node:24-bookworm-slim
# Chromium למערכת (israeli-bank-scrapers / puppeteer)
RUN apt-get update && apt-get install -y --no-install-recommends chromium fonts-noto-core ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true CHROMIUM_PATH=/usr/bin/chromium NODE_ENV=production TZ=Asia/Jerusalem
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY src ./src
COPY scripts ./scripts
RUN useradd -m app && mkdir -p /app/data && chown -R app /app/data
USER app
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
