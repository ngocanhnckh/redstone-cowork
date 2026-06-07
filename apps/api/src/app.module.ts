import { Module } from "@nestjs/common";
import { HealthController } from "./adapters/http/health.controller";

@Module({ controllers: [HealthController] })
export class AppModule {}
