import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const port = process.env.PORT || 3100;

  const app = await NestFactory.create(AppModule, {
    cors: true,
  });

  app.setGlobalPrefix('api');

  await app.listen(port);
  logger.log(`Dragnet backend running on http://localhost:${port}`);
  logger.log(`API available at http://localhost:${port}/api`);
}

bootstrap();
