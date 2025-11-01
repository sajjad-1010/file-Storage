import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { AppLoggerService, HttpRequestLogDetails } from './app-logger.service';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: AppLoggerService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<FastifyRequest>();
    const response = httpContext.getResponse<FastifyReply>();

    const requestId =
      (request as FastifyRequest & { id?: string }).id ??
      (request.headers['x-request-id'] as string | undefined) ??
      randomUUID();

    const requestDetails = this.extractRequestDetails(requestId, request);
    this.logger.logHttpRequest(requestDetails);

    const start = process.hrtime.bigint();

    return next.handle().pipe(
      tap(() => {
        const durationMs = this.calculateDurationMs(start);
        this.logger.logHttpResponse({
          requestId,
          method: request.method,
          url: request.url,
          statusCode: response.statusCode,
          durationMs,
          contentLength: this.extractResponseContentLength(response)
        });
      }),
      catchError((error) => {
        const durationMs = this.calculateDurationMs(start);
        const statusCode =
          (error as { statusCode?: number }).statusCode ??
          (error as { status?: number }).status ??
          500;
        this.logger.logHttpError({
          requestId,
          method: request.method,
          url: request.url,
          statusCode,
          durationMs,
          errorName: error instanceof Error ? error.name : typeof error,
          stack: error instanceof Error ? error.stack : undefined
        });
        return throwError(() => error);
      })
    );
  }

  private extractRequestDetails(requestId: string, request: FastifyRequest): HttpRequestLogDetails {
    const details: HttpRequestLogDetails = {
      requestId,
      method: request.method,
      url: request.url
    };

    if (request.ip) {
      details.ip = request.ip;
    }

    const userAgent = request.headers['user-agent'];
    if (typeof userAgent === 'string' && userAgent.length > 0) {
      details.userAgent = userAgent;
    }

    const userId = (request as FastifyRequest & { user?: { id?: string } }).user?.id;
    if (typeof userId === 'string' && userId.length > 0) {
      details.userId = userId;
    }

    const query = request.query as Record<string, unknown> | undefined;
    if (query && Object.keys(query).length > 0) {
      details.query = { ...query };
    }

    const body = request.body as unknown;
    if (body && this.isSerializableBody(body)) {
      details.body = body;
    }

    const contentLength = request.headers['content-length'];
    if (typeof contentLength === 'string' && contentLength.length > 0) {
      details.contentLength = contentLength;
    }

    return details;
  }

  private extractResponseContentLength(response: FastifyReply): number | undefined {
    const raw =
      typeof response.getHeader === 'function'
        ? (response.getHeader('content-length') as string | number | undefined)
        : undefined;

    if (typeof raw === 'number') {
      return raw;
    }
    if (typeof raw === 'string') {
      const parsed = Number(raw);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    return undefined;
  }

  private calculateDurationMs(start: bigint): number {
    const diffNs = Number(process.hrtime.bigint() - start);
    return Number((diffNs / 1_000_000).toFixed(3));
  }

  private isSerializableBody(body: unknown): boolean {
    if (body === null || body === undefined) {
      return false;
    }
    if (Buffer.isBuffer(body)) {
      return false;
    }
    if (typeof body === 'string') {
      return body.length > 0;
    }
    if (Array.isArray(body)) {
      return body.length > 0;
    }
    if (typeof body === 'object') {
      return Object.keys(body as Record<string, unknown>).length > 0;
    }
    return false;
  }
}
