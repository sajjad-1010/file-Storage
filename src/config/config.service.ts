import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentConfig } from './environment';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<EnvironmentConfig, true>) {}

  get nodeEnv(): string {
    return this.configService.get('nodeEnv', { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.configService.get('port', { infer: true });
  }

  get directories() {
    return this.configService.get('directories', { infer: true });
  }

  get maxUploadBytes(): number {
    return this.configService.get('maxUploadBytes', { infer: true });
  }

  get allowedImageMime(): string[] {
    return this.configService.get('allowedImageMime', { infer: true });
  }

  get allowedVideoMime(): string[] {
    return this.configService.get('allowedVideoMime', { infer: true });
  }

  get jwt() {
    return this.configService.get('jwt', { infer: true });
  }

  get media() {
    return this.configService.get('media', { infer: true });
  }

  get redis() {
    return this.configService.get('redis', { infer: true });
  }
}
