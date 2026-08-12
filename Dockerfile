# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS base

# ---- dependencies -----------------------------------------------------
# --ignore-scripts: one of our deps (msedge-tts) ships a preinstall script
# that hard-fails unless run through pnpm; none of our deps need their
# install scripts to run for functionality, so scripts are skipped entirely.
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# ---- build --------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime --------------------------------------------------------------
# A full node_modules is copied in (rather than next's standalone/traced
# output) because tesseract.js loads its worker script through requires the
# file tracer can't follow, which silently drops transitive deps like bmp-js.
FROM base AS runner
WORKDIR /app

# ffmpeg/ffprobe are required at runtime for TTS duration probing, video
# probing, thumbnail extraction, and OCR frame extraction.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV DATA_ROOT=/app/data

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs nextjs \
 && mkdir -p /app/data \
 && chown -R nextjs:nodejs /app/data

COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY package.json next.config.ts ./

USER nextjs

EXPOSE 3000

# Railway injects PORT; `next start` reads it directly.
CMD ["node_modules/.bin/next", "start"]
