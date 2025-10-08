/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { json, urlencoded } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  
  // Increase payload size limit for audio transcription
  app.use(
    json({
      limit: '10mb',
      verify: (req: any, res, buf) => {
        if (req.originalUrl === '/api/stripe/webhook') {
          req.rawBody = Buffer.from(buf);
        }
      },
    })
  );
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      // Coerce primitive types (e.g., "5.00" -> 5) for DTOs
      transformOptions: { enableImplicitConversion: true },
    })
  );
  // Security hardening
  app.use(helmet());
  // CORS for frontend origin; default to localhost:3000
  const appOrigin = process.env.APP_ORIGIN || 'http://localhost:3000';
  app.enableCors({
    origin: appOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`
  );
}

bootstrap();
