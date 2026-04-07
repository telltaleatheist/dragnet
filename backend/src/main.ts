import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { FileLogger } from './logging/file-logger';

async function bootstrap() {
  const fileLogger = new FileLogger();
  const logger = new Logger('Bootstrap');
  const port = process.env.PORT || 3100;

  const app = await NestFactory.create(AppModule, {
    cors: true,
    logger: fileLogger,
  });

  app.setGlobalPrefix('api');

  await app.listen(port);
  logger.log(`Dragnet backend running on http://localhost:${port}`);
  logger.log(`API available at http://localhost:${port}/api`);
}

bootstrap();
