FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @rcw/worker...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/worker apps/worker
RUN pnpm --filter @rcw/shared build && pnpm --filter @rcw/worker build
RUN pnpm --filter @rcw/worker deploy --prod --legacy /out

FROM node:22-alpine
WORKDIR /app
COPY --from=build /out .
COPY --from=build /repo/apps/worker/dist dist
CMD ["node", "dist/main.js"]
