import { Injectable, LoggerService } from '@nestjs/common';
import { AppConfigService } from '../../config/config.service';
import { createLogger, format, transports, Logger as WinstonLogger } from 'winston';

export type NestLogLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose';

export interface HttpRequestLogDetails {
  requestId: string;
  method: string;
  url: string;
  ip?: string;
  userId?: string;
  userAgent?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  contentLength?: string;
}

export interface HttpResponseLogDetails {
  requestId: string;
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  contentLength?: number;
}

export interface HttpErrorLogDetails {
  requestId: string;
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  errorName: string;
  stack?: string;
}

const LOG_LEVEL_MAP: Record<NestLogLevel, 'error' | 'warn' | 'info' | 'debug' | 'verbose'> = {
  error: 'error',
  warn: 'warn',
  log: 'info',
  debug: 'debug',
  verbose: 'verbose'
};

const LEVEL_PRIORITY: Record<'error' | 'warn' | 'info' | 'verbose' | 'debug', number> = {
  error: 0,
  warn: 1,
  info: 2,
  verbose: 3,
  debug: 4
};

export class ContextLogger {
  constructor(
    private readonly root: AppLoggerService,
    private readonly context: string,
    private readonly baseDetails: Record<string, unknown> = {}
  ) {}

  log(message: string, details?: Record<string, unknown>): void {
    this.root.application('log', message, this.context, this.merge(details));
  }

  info(message: string, details?: Record<string, unknown>): void {
    this.log(message, details);
  }

  warn(message: string, details?: Record<string, unknown>): void {
    this.root.application('warn', message, this.context, this.merge(details));
  }

  debug(message: string, details?: Record<string, unknown>): void {
    this.root.application('debug', message, this.context, this.merge(details));
  }

  verbose(message: string, details?: Record<string, unknown>): void {
    this.root.application('verbose', message, this.context, this.merge(details));
  }

  error(message: string, details?: Record<string, unknown>, error?: unknown): void {
    const normalized = this.root.normalizeError(error);
    const merged = this.merge({ ...details, ...(normalized.details ?? {}) });
    this.root.application('error', message, this.context, merged, normalized.stack);
  }

  extend(additional: Record<string, unknown>): ContextLogger {
    return new ContextLogger(this.root, this.context, { ...this.baseDetails, ...additional });
  }

  private merge(details?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!details) {
      return Object.keys(this.baseDetails).length ? { ...this.baseDetails } : undefined;
    }
    return { ...this.baseDetails, ...details };
  }
}

@Injectable()
export class AppLoggerService implements LoggerService {
  private readonly logger: WinstonLogger;
  private activeLevels = new Set<NestLogLevel>(['log', 'error', 'warn', 'debug', 'verbose']);

  constructor(private readonly config: AppConfigService) {
    const initialLevel = this.resolveInitialLevel();
    this.logger = createLogger({
      level: initialLevel,
      levels: {
        error: 0,
        warn: 1,
        info: 2,
        verbose: 3,
        debug: 4
      },
      format: format.combine(
        format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        format.printf((info) => this.formatEntry(info))
      ),
      transports: [new transports.Console()]
    });
  }

  setLogLevels(levels: NestLogLevel[]): void {
    if (!levels || levels.length === 0) {
      this.activeLevels = new Set(['error']);
      this.logger.level = 'error';
      return;
    }

    this.activeLevels = new Set(levels);
    const resolvedLevels = levels.map((level) => LOG_LEVEL_MAP[level]);
    const highestPriority = Math.max(...resolvedLevels.map((lvl) => LEVEL_PRIORITY[lvl]));
    const effective = (Object.entries(LEVEL_PRIORITY).find(([, priority]) => priority === highestPriority)?.[0] ??
      'info') as 'error' | 'warn' | 'info' | 'verbose' | 'debug';
    this.logger.level = effective;
  }

  log(message: string, context?: string): void {
    this.application('log', message, context);
  }

  error(message: string, trace?: string, context?: string): void {
    this.application('error', message, context, undefined, trace);
  }

  warn(message: string, context?: string): void {
    this.application('warn', message, context);
  }

  debug(message: string, context?: string): void {
    this.application('debug', message, context);
  }

  verbose(message: string, context?: string): void {
    this.application('verbose', message, context);
  }

  forContext(context: string, baseDetails: Record<string, unknown> = {}): ContextLogger {
    return new ContextLogger(this, context, baseDetails);
  }

  logHttpRequest(details: HttpRequestLogDetails): void {
    this.logger.log({
      level: 'info',
      message: 'HTTP request',
      event: 'http.request',
      details: this.cleanDetails(details)
    });
  }

  logHttpResponse(details: HttpResponseLogDetails): void {
    this.logger.log({
      level: 'info',
      message: 'HTTP response',
      event: 'http.response',
      details: this.cleanDetails(details)
    });
  }

  logHttpError(details: HttpErrorLogDetails): void {
    const cleaned = this.cleanDetails(details);
    const { stack, ...rest } = cleaned ?? {};
    this.logger.log({
      level: 'error',
      message: 'HTTP error',
      event: 'http.error',
      details: rest,
      stack
    });
  }

  application(
    level: NestLogLevel,
    message: string,
    context?: string,
    details?: Record<string, unknown>,
    stack?: string
  ): void {
    if (!this.activeLevels.has(level) && level !== 'error') {
      return;
    }

    const event = this.resolveApplicationEvent(level);
    const cleanedDetails = this.cleanDetails({
      ...(context ? { context } : {}),
      ...(details ?? {})
    }) as Record<string, unknown> | undefined;

    this.logger.log({
      level: LOG_LEVEL_MAP[level],
      message,
      event,
      details: cleanedDetails,
      ...(stack ? { stack } : {})
    });
  }

  normalizeError(error: unknown): { details?: Record<string, unknown>; stack?: string } {
    if (!error) {
      return {};
    }

    if (error instanceof Error) {
      return {
        details: {
          errorName: error.name,
          errorMessage: error.message
        },
        stack: error.stack
      };
    }

    if (typeof error === 'string') {
      return {
        details: {
          errorMessage: error
        }
      };
    }

    if (typeof error === 'object') {
      return {
        details: this.cleanDetails(error as Record<string, unknown>) as Record<string, unknown>
      };
    }

    return {
      details: {
        errorMessage: String(error)
      }
    };
  }

  private resolveInitialLevel(): 'error' | 'warn' | 'info' | 'debug' | 'verbose' {
    const envLevel = (process.env.LOG_LEVEL ?? (this.config.isProduction ? 'info' : 'debug')).toLowerCase();
    if (['error', 'warn', 'info', 'debug', 'verbose'].includes(envLevel)) {
      return envLevel as 'error' | 'warn' | 'info' | 'debug' | 'verbose';
    }
    return 'info';
  }

  private resolveApplicationEvent(level: NestLogLevel): string {
    switch (level) {
      case 'error':
        return 'application.error';
      case 'warn':
        return 'application.warn';
      case 'debug':
        return 'application.debug';
      case 'verbose':
        return 'application.verbose';
      case 'log':
      default:
        return 'application.log';
    }
  }

  private cleanDetails(details?: Record<string, unknown> | unknown): Record<string, unknown> | undefined {
    const normalized = this.normalize(details);
    if (this.isPlainObject(normalized) && Object.keys(normalized).length === 0) {
      return undefined;
    }
    return this.isPlainObject(normalized) ? normalized : undefined;
  }

  private normalize(value: unknown): unknown {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (Array.isArray(value)) {
      const cleanedArray = value
        .map((item) => this.normalize(item))
        .filter((item) => item !== undefined);
      return cleanedArray.length ? cleanedArray : undefined;
    }

    if (this.isPlainObject(value)) {
      const entries = Object.entries(value as Record<string, unknown>)
        .map(([key, val]) => [key, this.normalize(val)] as [string, unknown])
        .filter(([, val]) => val !== undefined);
      return entries.length ? Object.fromEntries(entries) : undefined;
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    return value;
  }

  private formatEntry(info: Record<string, unknown>): string {
    const timestamp = info.timestamp as string;
    const level = String(info.level ?? '').toUpperCase();
    const event = (info.event as string) ?? 'application.log';
    const message = (info.message as string) ?? '';
    const header = `${timestamp} ${level} ${event}: ${message}`;

    const details = (info.details as Record<string, unknown> | undefined) ?? {};
    const stack = info.stack as string | undefined;

    const detailBlock = this.serializeDetails(details);
    const stackBlock = stack ? this.serializeDetails({ stack }) : '';

    const blocks = [detailBlock, stackBlock].filter((block) => block.length > 0);
    if (!blocks.length) {
      return header;
    }

    return `${header}\n${blocks.join('\n')}`;
  }

  private serializeDetails(details: Record<string, unknown>): string {
    const cleaned = this.normalize(details);
    if (!this.isPlainObject(cleaned) || Object.keys(cleaned as Record<string, unknown>).length === 0) {
      return '';
    }
    return this.serialize(cleaned as Record<string, unknown>, 1);
  }

  private serialize(value: unknown, depth: number): string {
    const indent = '  '.repeat(depth);

    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (this.isPlainObject(item) || Array.isArray(item)) {
            const nested = this.serialize(item, depth + 1);
            return `${indent}-\n${nested}`;
          }
          return `${indent}- ${this.formatPrimitive(item)}`;
        })
        .join('\n');
    }

    if (this.isPlainObject(value)) {
      return Object.entries(value as Record<string, unknown>)
        .map(([key, val]) => {
          if (this.isPlainObject(val) || Array.isArray(val)) {
            const nested = this.serialize(val, depth + 1);
            return `${indent}${key}:\n${nested}`;
          }
          return `${indent}${key}: ${this.formatPrimitive(val)}`;
        })
        .join('\n');
    }

    return `${indent}${this.formatPrimitive(value)}`;
  }

  private formatPrimitive(value: unknown): string {
    if (typeof value === 'string') {
      return `"${value.replace(/"/g, '\\"')}"`;
    }
    if (value instanceof Date) {
      return `"${value.toISOString()}"`;
    }
    return String(value);
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
}
