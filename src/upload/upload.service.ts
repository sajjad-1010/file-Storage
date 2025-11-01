import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import Busboy from 'busboy';
import { fileTypeFromBuffer } from 'file-type';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppConfigService } from '../config/config.service';
import { UploadTokenPayload } from '../media/types/upload-token.type';
import { ImageService } from '../image/image.service';
import { VideoService } from '../video/video.service';
import { UploadResponseDto } from '../media/dto/upload-response.dto';
import { AppLoggerService, ContextLogger } from '../common/logger/app-logger.service';

const SNIFF_LENGTH = 4100;

interface UploadProcessingResult {
  response: UploadResponseDto;
  meta: {
    sha: string;
    width: number;
    height: number;
    durationMs: number | null;
    deduped: boolean;
  };
}

@Injectable()
export class UploadService {
  private readonly baseLogger: ContextLogger;

  constructor(
    private readonly config: AppConfigService,
    private readonly imageService: ImageService,
    private readonly videoService: VideoService,
    loggerService: AppLoggerService
  ) {
    this.baseLogger = loggerService.forContext(UploadService.name, { domain: 'upload' });
  }

  async handleUpload(request: FastifyRequest, token: UploadTokenPayload): Promise<UploadResponseDto> {
    const hardLimit = Math.min(this.config.maxUploadBytes, token.maxSize ?? this.config.maxUploadBytes);
    const requestId =
      (request as FastifyRequest & { id?: string }).id ??
      (request.headers['x-request-id'] as string | undefined) ??
      randomUUID();

    const requestLogger = this.baseLogger.extend({
      requestId,
      userId: token.sub,
      kind: token.kind
    });

    const requestDetails: Record<string, unknown> = {
      code: 'upload.request.received',
      hardLimitBytes: hardLimit
    };
    if (typeof token.maxSize === 'number') {
      requestDetails.maxSizeBytes = token.maxSize;
    }
    const contentLength = request.headers['content-length'];
    if (typeof contentLength === 'string') {
      requestDetails.contentLength = contentLength;
    }
    requestLogger.info('Upload request received', requestDetails);

    return new Promise<UploadResponseDto>((resolve, reject) => {
      const busboy = Busboy({
        headers: request.headers,
        limits: {
          files: 1,
          fileSize: hardLimit
        }
      });

      let processed = false;
      let finished = false;

      const cleanupListeners = () => {
        finished = true;
      };

      busboy.on('file', (_fieldname, file, info) => {
        if (processed) {
          file.resume();
          requestLogger.warn('Multiple files provided; rejecting request', {
            code: 'upload.multiple-files'
          });
          reject(new BadRequestException('Only one file is allowed per request'));
          return;
        }

        processed = true;

        this.processIncomingFile(file, info.filename, token, hardLimit, requestLogger)
          .then(({ response, meta }) => {
            const completion: Record<string, unknown> = {
              code: 'upload.request.completed',
              mediaId: response.mediaId,
              sha256: response.sha256,
              storageKeyOriginal: response.storageKeyOriginal,
              storageKeyThumb: response.storageKeyThumb,
              bytes: response.bytes,
              deduplicated: meta.deduped
            };
            if (meta.durationMs !== null) {
              completion.durationMs = meta.durationMs;
            }
            if (meta.width) {
              completion.width = meta.width;
            }
            if (meta.height) {
              completion.height = meta.height;
            }

            requestLogger.info('Upload succeeded', completion);
            resolve(response);
          })
          .catch((error) => {
            requestLogger.error(
              'Upload failed',
              {
                code: 'upload.request.failed'
              },
              error as Error
            );
            reject(error);
          })
          .finally(() => cleanupListeners());
      });

      busboy.on('error', (err) => {
        if (!finished) {
          reject(new BadRequestException(err instanceof Error ? err.message : 'Upload failed'));
        }
      });

      busboy.on('finish', () => {
        if (!processed) {
          reject(new BadRequestException('No file field provided'));
        }
      });

      request.raw.pipe(busboy);
    });
  }

  private async processIncomingFile(
    fileStream: NodeJS.ReadableStream,
    filename: string,
    token: UploadTokenPayload,
    hardLimit: number,
    requestLogger: ContextLogger
  ): Promise<UploadProcessingResult> {
    const tmpFile = `${randomUUID()}.tmp`;
    const tmpPath = path.join(this.config.directories.tmpDir, tmpFile);
    const sniffChunks: Buffer[] = [];
    let sniffBytes = 0;
    let totalBytes = 0;
    const fileWriteStream = createWriteStream(tmpPath);
    let busboyLimitReached = false;

    requestLogger.debug('Started buffering upload stream', {
      code: 'upload.stream.start',
      tmpFile,
      originalFilename: filename
    });

    fileStream.on('limit', () => {
      busboyLimitReached = true;
      requestLogger.warn('Busboy file size limit reached', {
        code: 'upload.limit.busboy',
        hardLimitBytes: hardLimit
      });
    });

    const tapStream = new Transform({
      transform: (chunk, _encoding, callback) => {
        const buffer = chunk as Buffer;
        if (sniffBytes < SNIFF_LENGTH) {
          const slice = buffer.slice(0, SNIFF_LENGTH - sniffBytes);
          sniffChunks.push(slice);
          sniffBytes += slice.length;
        }

        totalBytes += buffer.length;
        if (totalBytes > hardLimit) {
          callback(new PayloadTooLargeException('File exceeds allowed size'));
          return;
        }

        callback(null, buffer);
      }
    });

    try {
      await pipeline(fileStream, tapStream, fileWriteStream);
      requestLogger.debug('Upload stream completed', {
        code: 'upload.stream.completed',
        tmpFile,
        totalBytes
      });
    } catch (error) {
      await fs.unlink(tmpPath).catch(() => undefined);
      if (error instanceof PayloadTooLargeException) {
        throw error;
      }
      requestLogger.error(
        'Failed to read upload stream',
        {
          code: 'upload.stream.error'
        },
        error as Error
      );
      throw new BadRequestException('Failed to read upload stream');
    }

    if (busboyLimitReached) {
      await fs.unlink(tmpPath).catch(() => undefined);
      throw new PayloadTooLargeException('File exceeds allowed size');
    }

    if (totalBytes === 0) {
      await fs.unlink(tmpPath).catch(() => undefined);
      requestLogger.warn('Uploaded file was empty', { code: 'upload.file.empty' });
      throw new BadRequestException('Uploaded file is empty');
    }

    const sniffBuffer = Buffer.concat(sniffChunks);
    const detected = await fileTypeFromBuffer(sniffBuffer);
    if (!detected) {
      await fs.unlink(tmpPath).catch(() => undefined);
      requestLogger.warn('Unable to detect file type', { code: 'upload.mime.unknown' });
      throw new UnsupportedMediaTypeException('Unable to detect file type');
    }

    requestLogger.info('Detected upload media type', {
      code: 'upload.media.detected',
      mime: detected.mime,
      ext: detected.ext,
      bytes: totalBytes
    });

    this.assertMimeAllowed(detected.mime, token.kind, requestLogger);

    let result: UploadProcessingResult;
    try {
      if (token.kind === 'image') {
        const imageResult = await this.handleImageUpload(tmpPath, detected.ext, detected.mime, token);
        requestLogger.info('Image processed successfully', {
          code: 'upload.image.processed',
          sha: imageResult.meta.sha,
          bytes: imageResult.response.bytes,
          width: imageResult.meta.width,
          height: imageResult.meta.height,
          deduplicated: imageResult.meta.deduped
        });
        result = imageResult;
      } else {
        const videoResult = await this.handleVideoUpload(tmpPath, detected.ext, detected.mime, token);
        requestLogger.info('Video processed successfully', {
          code: 'upload.video.processed',
          sha: videoResult.meta.sha,
          bytes: videoResult.response.bytes,
          width: videoResult.meta.width,
          height: videoResult.meta.height,
          durationMs: videoResult.meta.durationMs ?? undefined,
          deduplicated: videoResult.meta.deduped
        });
        result = videoResult;
      }
    } finally {
      await fs.unlink(tmpPath).catch(() => undefined);
    }

    return result;
  }

  private async handleImageUpload(
    tmpPath: string,
    ext: string,
    mime: string,
    token: UploadTokenPayload
  ): Promise<UploadProcessingResult> {
    const processed = await this.imageService.processImage({
      tmpPath,
      ext,
      mime
    });

    return {
      response: {
        mediaId: randomUUID(),
        ownerId: token.sub,
        kind: 'image',
        mime: processed.mime,
        bytes: processed.bytes,
        width: processed.width,
        height: processed.height,
        durationMs: null,
        storageKeyOriginal: processed.paths.originalKey,
        storageKeyThumb: processed.paths.thumbKey,
        sha256: processed.sha,
        status: 'ready'
      },
      meta: {
        sha: processed.sha,
        width: processed.width,
        height: processed.height,
        durationMs: null,
        deduped: !processed.paths.isNew
      }
    };
  }

  private async handleVideoUpload(
    tmpPath: string,
    ext: string,
    mime: string,
    token: UploadTokenPayload
  ): Promise<UploadProcessingResult> {
    const maxVideoSec = token.maxVideoSec ?? 60;
    const processed = await this.videoService.processVideo({
      tmpPath,
      ext,
      mime,
      maxDurationSec: maxVideoSec
    });

    return {
      response: {
        mediaId: randomUUID(),
        ownerId: token.sub,
        kind: 'video',
        mime: processed.mime,
        bytes: processed.bytes,
        width: processed.width,
        height: processed.height,
        durationMs: processed.durationMs,
        storageKeyOriginal: processed.paths.originalKey,
        storageKeyThumb: processed.paths.thumbKey,
        sha256: processed.sha,
        status: 'ready'
      },
      meta: {
        sha: processed.sha,
        width: processed.width,
        height: processed.height,
        durationMs: processed.durationMs,
        deduped: !processed.paths.isNew
      }
    };
  }

  private assertMimeAllowed(mime: string, kind: 'image' | 'video', logger: ContextLogger): void {
    const allowed = kind === 'image' ? this.config.allowedImageMime : this.config.allowedVideoMime;
    if (!allowed.includes(mime)) {
      logger.warn('Rejected MIME type for upload', {
        code: 'upload.mime.rejected',
        mime,
        kind
      });
      throw new UnsupportedMediaTypeException(`MIME type ${mime} not allowed for ${kind}`);
    }
  }
}
