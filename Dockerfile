# syntax=docker/dockerfile:1
# TagTeam — single-container build. Runtime is node:22-slim (glibc) so
# better-sqlite3's prebuilt binaries work without a native toolchain.

FROM node:22-slim AS build
WORKDIR /app
RUN npm install -g pnpm@11
# VITE_* vars are baked into the client bundle at build time. `.env` is
# dockerignored + git-ignored, so the deployed image gets them via build args
# (compose interpolates them from the stack .env on Core).
ARG VITE_PRESENTER_URL
ARG VITE_LLM_MODEL
ARG VITE_OPENCV_URL
ARG VITE_TTS_PROVIDER
ENV VITE_PRESENTER_URL=$VITE_PRESENTER_URL \
    VITE_LLM_MODEL=$VITE_LLM_MODEL \
    VITE_OPENCV_URL=$VITE_OPENCV_URL \
    VITE_TTS_PROVIDER=$VITE_TTS_PROVIDER
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
