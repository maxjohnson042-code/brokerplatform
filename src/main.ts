import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { env } from './config/env';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(env.port);
  console.log(`Thriski listening on :${env.port} (GET /health to check)`);
}

bootstrap();
