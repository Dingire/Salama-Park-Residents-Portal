FROM node:24-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.14.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json .npmrc ./
COPY lib ./lib
COPY artifacts ./artifacts
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile --ignore-scripts

ENV VITE_CLERK_PUBLISHABLE_KEY=${VITE_CLERK_PUBLISHABLE_KEY}
ENV BASE_PATH=/

RUN pnpm rebuild esbuild @clerk/shared && pnpm -r --if-present run build

FROM node:24-slim AS runner

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@12.14.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/artifacts ./artifacts

ENV PORT=8080
ENV NODE_ENV=production
ENV WEB_DIST_DIR=artifacts/salama-park-portal/dist/public
ENV RUN_MIGRATIONS=true

EXPOSE 8080
CMD ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]
