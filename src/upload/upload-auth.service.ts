import {
  BadRequestException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { AppConfigService } from '../config/config.service';
import { UploadTokenPayload } from '../media/types/upload-token.type';
import { AppLoggerService, ContextLogger } from '../common/logger/app-logger.service';

@Injectable()
export class UploadAuthService {
  private readonly logger: ContextLogger;

  constructor(
    private readonly config: AppConfigService,
    loggerService: AppLoggerService
  ) {
    this.logger = loggerService.forContext(UploadAuthService.name, { domain: 'auth' });
  }

  verifyAuthorizationHeader(header?: string): UploadTokenPayload {
    if (!header) {
      this.logger.warn('Missing Authorization header', { code: 'auth.header.missing' });
      throw new UnauthorizedException('Missing Authorization header');
    }

    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      this.logger.warn('Invalid Authorization header format', { code: 'auth.header.invalid' });
      throw new UnauthorizedException('Invalid Authorization header format');
    }

    return this.verifyToken(token);
  }

  private verifyToken(token: string): UploadTokenPayload {
    const jwtConfig = this.config.jwt;
    const key = jwtConfig.key;

    if (!key) {
      this.logger.error('JWT verification key not configured', { code: 'auth.config.missing' });
      throw new UnauthorizedException('JWT verification key not configured');
    }

    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(token, key, {
        algorithms: [jwtConfig.algorithm]
      }) as jwt.JwtPayload;
    } catch (error) {
      this.logger.warn('Invalid or expired upload token', { code: 'auth.token.invalid' });
      throw new UnauthorizedException('Invalid or expired upload token');
    }

    const payload: UploadTokenPayload = {
      sub: this.assertString(decoded.sub, 'sub'),
      kind: this.assertKind(decoded.kind),
      maxSize: this.assertOptionalNumber(decoded.maxSize, 'maxSize'),
      postId: this.assertOptionalString(decoded.postId, 'postId'),
      maxVideoSec: this.assertOptionalNumber(decoded.maxVideoSec, 'maxVideoSec'),
      exp: this.assertNumber(decoded.exp, 'exp')
    };

    if (payload.maxVideoSec && payload.maxVideoSec > 60) {
      this.logger.warn('maxVideoSec cannot exceed 60 seconds', {
        code: 'auth.token.invalid-claim',
        maxVideoSec: payload.maxVideoSec
      });
      throw new BadRequestException('maxVideoSec cannot exceed 60 seconds');
    }

    const debugDetails: Record<string, unknown> = {
      code: 'auth.token.verified',
      userId: payload.sub,
      kind: payload.kind,
      exp: payload.exp
    };
    if (payload.maxSize !== undefined) {
      debugDetails.maxSize = payload.maxSize;
    }
    if (payload.maxVideoSec !== undefined) {
      debugDetails.maxVideoSec = payload.maxVideoSec;
    }

    this.logger.debug('Upload token verified', debugDetails);

    return payload;
  }

  private assertString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value) {
      throw new UnauthorizedException(`Token is missing required claim "${field}"`);
    }
    return value;
  }

  private assertOptionalString(value: unknown, field: string): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value !== 'string') {
      throw new UnauthorizedException(`Token claim "${field}" must be a string`);
    }
    return value;
  }

  private assertNumber(value: unknown, field: string): number {
    if (typeof value !== 'number') {
      throw new UnauthorizedException(`Token claim "${field}" must be a number`);
    }
    return value;
  }

  private assertOptionalNumber(value: unknown, field: string): number | undefined {
    if (value === null || value === undefined) {
      return undefined;
    }
    if (typeof value !== 'number') {
      throw new UnauthorizedException(`Token claim "${field}" must be a number`);
    }
    return value;
  }

  private assertKind(value: unknown): 'image' | 'video' {
    if (value === 'image' || value === 'video') {
      return value;
    }
    throw new UnauthorizedException(`Invalid token kind "${String(value)}"`);
  }
}
