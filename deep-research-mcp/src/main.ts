import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });

  app.enableCors({
    origin: true,
    credentials: true,
  });

  app.use(helmet());

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  );

  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const port = Number(
    process.env.PORT ?? process.env.DEEP_RESEARCH_MCP_PORT ?? 4100
  );
  await app.listen(port);
  Logger.log(
    `🚀 Deep Research MCP server running at http://localhost:${port}/${globalPrefix}`
  );
}

bootstrap();
