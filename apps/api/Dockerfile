FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @rcw/api...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @rcw/shared build && pnpm --filter @rcw/api build
RUN pnpm --filter @rcw/api deploy --prod --legacy /out

FROM node:22-alpine
WORKDIR /app
COPY --from=build /out .
COPY --from=build /repo/apps/api/dist dist
COPY --from=build /repo/apps/api/migrations migrations
COPY prompts /prompts
ENV PROMPTS_DIR=/prompts
CMD ["sh", "-c", "node dist/infrastructure/migrate.js && node dist/main.js"]
