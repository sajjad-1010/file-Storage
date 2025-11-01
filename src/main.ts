import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { AppConfigService } from './config/config.service';
import { setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({ bodyLimit: 104857600 }); // 100 MB hard cap
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true
  });

  await setupApp(app);

  const config = app.get(AppConfigService);
  const logger = new Logger('Bootstrap');
  await app.listen(config.port, '0.0.0.0');
  logger.log(`File Storage service listening on port ${config.port}`);
}

void bootstrap();
