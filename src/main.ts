import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // whitelist/transform: Epic 2 is the first epic with request-body DTOs
  // (class-validator decorated) — strip unknown fields rather than silently accept
  // them, and coerce payloads into the DTO classes so nested class-validator rules run.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Permissive dev CORS — apps/web (a separate origin in local dev) needs to call this
  // API cross-origin. Tighten to an explicit origin allowlist before production.
  app.enableCors({ origin: true, credentials: true });
  await app.listen(env.port);
  console.log(`Thriski listening on :${env.port} (GET /health to check)`);
}

bootstrap();
