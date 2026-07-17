import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";
import { loadConfig } from "./infrastructure/config";

// Body-parser limit. The default (100 KB) rejects a large session state push — a
// long transcript / big latestAnswer — with 413 PayloadTooLarge, so that session's
// updates silently stop reaching the cockpit. Raise it generously; the host also
// bounds what it sends (see readRecentMessages), so this is a safety ceiling.
// Uses Nest's own body parser (via @nestjs/platform-express) — NOT a bare `express`
// import, which isn't a resolvable direct dep in the pruned production image.
const BODY_LIMIT = "25mb";

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser("json", { limit: BODY_LIMIT });
  app.useBodyParser("urlencoded", { extended: true, limit: BODY_LIMIT });
  await app.listen(config.PORT);
  console.log(`[api] listening on :${config.PORT}`);
}
bootstrap().catch((err) => {
  console.error("[api] fatal:", err);
  process.exit(1);
});
