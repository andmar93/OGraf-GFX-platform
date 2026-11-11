# syntax=docker/dockerfile:1
# ---- build ----
FROM node:24-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @ogp/renderer --filter @ogp/player --filter @ogp/data --filter @ogp/server build
# production node_modules for the server (workspace packages are bundled into dist/main.js)
RUN pnpm --filter @ogp/server deploy --prod --legacy /out

# ---- runtime ----
FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    MIGRATIONS_DIR=/app/dist/drizzle \
    RENDERER_DIST=/app/renderer \
    PLAYER_DIST=/app/player \
    DATA_APP_DIST=/app/data-app \
    PUBLIC_DIR=/app/public \
    SEED_GRAPHICS_DIR=/app/seed-graphics \
    SEED_MODE=once
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/public ./public
COPY --from=build /app/apps/renderer/dist ./renderer
COPY --from=build /app/apps/player/dist ./player
COPY --from=build /app/apps/data/dist ./data-app
COPY --from=build /app/graphics ./seed-graphics
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
