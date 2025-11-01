import { Global, Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { AppLoggerService } from './logger/app-logger.service';
import { RequestLoggingInterceptor } from './logger/request-logging.interceptor';

@Global()
@Module({
  controllers: [HealthController],
  providers: [AppLoggerService, RequestLoggingInterceptor],
  exports: [AppLoggerService, RequestLoggingInterceptor]
})
export class CommonModule {}
