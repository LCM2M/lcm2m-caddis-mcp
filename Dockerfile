# syntax=docker/dockerfile:1.7

# ---- dev stage --------------------------------------------------------------
# Bare Node toolbox. Compose targets this stage and bind-mounts the workspace,
# so commands like `npm install`, `npm run build`, `npm run lint` run here.
FROM node:25-trixie-slim AS dev
WORKDIR /app

# ---- build stage ------------------------------------------------------------
# Compiles TypeScript. Requires a committed package-lock.json (run
# `docker compose run --rm dev npm install` once to generate it).
FROM dev AS build
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- prod-deps stage --------------------------------------------------------
FROM node:25-trixie-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# ---- runtime stage ----------------------------------------------------------
# The shippable image. Stdin-friendly (ENTRYPOINT is a bare node process) so
# MCP clients can run it with `docker run -i --rm ...`.
FROM node:25-trixie-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
ENTRYPOINT ["node", "dist/index.js"]
