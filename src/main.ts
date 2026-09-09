import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap() {
  // rawBody: true makes the exact, unparsed request bytes available as req.rawBody —
  // needed by the Sumsub webhook route (verification.controller.ts) to verify an
  // HMAC signature computed over those exact bytes, which JSON body-parsing would
  // otherwise discard (re-serializing rarely reproduces the same bytes that were
  // actually signed). Available on every route, but only the webhook one reads it.
  const app = await NestFactory.create(AppModule, { rawBody: true });
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
