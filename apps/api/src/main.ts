import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json, urlencoded } from "express";
import { AppModule } from "./app.module";
import { loadConfig } from "./infrastructure/config";

// Body-parser limit. The default (100 KB) rejects a large session state push — a
// long transcript / big latestAnswer — with 413 PayloadTooLarge, so that session's
// updates silently stop reaching the cockpit. Raise it generously; the host also
// bounds what it sends (see readRecentMessages), so this is a safety ceiling.
const BODY_LIMIT = "25mb";

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: BODY_LIMIT }));
  await app.listen(config.PORT);
  console.log(`[api] listening on :${config.PORT}`);
}
bootstrap().catch((err) => {
  console.error("[api] fatal:", err);
  process.exit(1);
});
