import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnvironment } from './environment';
import { AppConfigService } from './config.service';
import { StorageInitializerService } from './storage-initializer.service';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      validate: validateEnvironment
    })
  ],
  providers: [AppConfigService, StorageInitializerService],
  exports: [AppConfigService, StorageInitializerService]
})
export class AppConfigModule {}
