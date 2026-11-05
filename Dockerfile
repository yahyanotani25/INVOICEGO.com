# InvoiceGO production image (API + built SPA + job worker).
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY server/package*.json server/
COPY web/package*.json web/
RUN npm ci --prefix server && npm ci --prefix web
COPY server server
COPY web web
RUN npm run build --prefix web \
 && rm -rf server/public && cp -r web/dist server/public \
 && npx --prefix server prisma generate --schema server/prisma/schema.prisma \
 && npm run build --prefix server \
 && npm prune --omit=dev --prefix server

FROM node:22-bookworm-slim
ENV NODE_ENV=production
# pg_dump must be >= the PostgreSQL server version (PGDG repo provides 16)
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl gnupg \
 && install -d /usr/share/postgresql-common/pgdg \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update && apt-get install -y --no-install-recommends postgresql-client-16 \
 && apt-get purge -y curl gnupg && rm -rf /var/lib/apt/lists/*
WORKDIR /app/server
COPY --from=build /app/server/node_modules node_modules
COPY --from=build /app/server/dist dist
COPY --from=build /app/server/public public
COPY --from=build /app/server/prisma prisma
COPY --from=build /app/server/data data
COPY --from=build /app/server/assets assets
COPY --from=build /app/server/package.json package.json
RUN useradd --system --uid 10001 invoicego && mkdir -p /var/lib/invoicego/backups && chown -R invoicego /var/lib/invoicego
USER invoicego
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply migrations, then start. Reference data import is a separate, explicit step.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/index.js"]
