FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @rcw/web...
COPY apps/web apps/web
RUN pnpm --filter @rcw/web build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone .
COPY --from=build /repo/apps/web/.next/static apps/web/.next/static
# standalone output does not include public/ — copy it so /sw.js, the manifest,
# and icons (service worker + PWA) are served.
COPY --from=build /repo/apps/web/public apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
