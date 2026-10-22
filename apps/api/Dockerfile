# --- build -----------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY apps/api apps/api
RUN npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w apps/api

# --- runtime ---------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/package.json ./apps/api/package.json
COPY package.json ./package.json
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data/uploads \
 && chown -R node:node /data /app
USER node
EXPOSE 4000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/server.js"]
