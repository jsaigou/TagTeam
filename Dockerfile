# syntax=docker/dockerfile:1
# TagTeam — single-container build. Runtime is node:22-slim (glibc) so
# better-sqlite3's prebuilt binaries work without a native toolchain.

FROM node:22-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN npm install -g pnpm@11
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/server.mjs ./server.mjs
COPY --from=build /app/src/shared ./src/shared
COPY --from=build /app/.env.example ./.env.example

ENV PORT=8083
EXPOSE 8083
VOLUME /app/data
# Config comes from the environment (docker compose env_file) — no --env-file needed.
CMD ["node", "server.mjs"]
