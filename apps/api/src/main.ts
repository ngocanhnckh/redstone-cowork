import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { loadConfig } from "./infrastructure/config";

async function bootstrap() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule);
  await app.listen(config.PORT);
  console.log(`[api] listening on :${config.PORT}`);
}
bootstrap();
