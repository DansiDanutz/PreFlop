# PreFlop — one build stage for the whole monorepo, then small runtime images per service.
#   docker compose up --build        (see docker-compose.yml)
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
ARG VITE_API_URL=http://localhost:4000
ARG VITE_WEB_URL=http://localhost:8080
ENV VITE_API_URL=$VITE_API_URL VITE_WEB_URL=$VITE_WEB_URL
RUN pnpm -r build
# Production dependencies only, with workspace packages linked to their dist/ builds.
RUN pnpm --filter @preflop/api deploy --legacy --prod /out/api

# ---- API (+ worker in-process; set RUN_WORKER=false to run it separately)
FROM node:22-bookworm-slim AS api
WORKDIR /srv
ENV NODE_ENV=production PORT=4000
COPY --from=build /out/api /srv
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]

# ---- Simulated tables (sandbox only)
FROM build AS sim
WORKDIR /app/apps/api
CMD ["npx", "tsx", "--conditions=preflop-source", "src/sim/cli.ts"]

# ---- Static web apps (website + player app, console, club tablet)
FROM nginx:1.27-alpine AS web
COPY deploy/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
FROM nginx:1.27-alpine AS console
COPY deploy/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/console/dist /usr/share/nginx/html
FROM nginx:1.27-alpine AS table
COPY deploy/nginx-spa.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/table/dist /usr/share/nginx/html
