# syntax=docker/dockerfile:1

# Builds the signed-in ("online") edition: the React app plus the Node API server that serves it.
# The standalone edition is published separately to GitHub Pages (see .github/workflows/deploy-pages.yml).

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build:online && npm run build:server

FROM node:24-alpine AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/ricsam/dart-scorer" \
      org.opencontainers.image.description="Oche darts scorer — online edition with rooms and leaderboards"
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    STATIC_DIR=/app/dist-online \
    DATABASE_PATH=/data/oche.db
WORKDIR /app
COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=build /app/dist-online ./dist-online
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
VOLUME ["/data"]
CMD ["node", "--enable-source-maps", "dist-server/index.mjs"]
