import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import multipart from '@fastify/multipart';
import { AppConfigService } from './config/config.service';
import { RequestLoggingInterceptor } from './common/logger/request-logging.interceptor';

export const setupApp = async (app: NestFastifyApplication): Promise<void> => {
  app.enableShutdownHooks();
  const config = app.get(AppConfigService);
  await app.register(multipart, {
    limits: {
      fieldNameSize: 100,
      fieldSize: 1024 * 1024,
      fields: 10,
      fileSize: config.maxUploadBytes,
      files: 1,
      headerPairs: 2000
    }
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY
    })
  );

  const requestLoggingInterceptor = app.get(RequestLoggingInterceptor);
  app.useGlobalInterceptors(requestLoggingInterceptor);
};
