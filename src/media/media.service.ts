import { Injectable, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import fg from 'fast-glob';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import ffprobeStatic from 'ffprobe-static';
import { AppConfigService } from '../config/config.service';
import { MediaMetadataDto } from './dto/media-metadata.dto';
import { MediaKind } from './types/upload-token.type';
import { AppLoggerService, ContextLogger } from '../common/logger/app-logger.service';

const execFileAsync = promisify(execFile);

export interface MediaPathsResult {
  originalPath: string;
  thumbPath: string;
  originalKey: string;
  thumbKey: string;
  isNew: boolean;
  relativeDir: string;
}

@Injectable()
export class MediaService {
  private readonly logger: ContextLogger;

  constructor(
    private readonly config: AppConfigService,
    loggerService: AppLoggerService
  ) {
    this.logger = loggerService.forContext(MediaService.name, { domain: 'media' });
  }

  buildDatePath(date: Date = new Date()): string {
    const year = date.getUTCFullYear();
    const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
    const day = `${date.getUTCDate()}`.padStart(2, '0');
    return path.posix.join(year.toString(), month, day);
  }

  async resolvePathsForSha(sha: string, ext: string): Promise<MediaPathsResult> {
    const {
      directories: { originalsDir, thumbsDir }
    } = this.config;

    const existing = await this.findExistingOriginal(sha, ext);
    if (existing) {
      const originalKey = this.buildStorageKey(existing, originalsDir, 'o');
      const thumbPath = this.deriveThumbPathFromOriginal(existing, thumbsDir);
      const thumbKey = this.buildStorageKey(thumbPath, thumbsDir, 't');
      this.logger.info('Reused media paths', {
        code: 'media.path.reused',
        sha,
        originalKey,
        thumbKey
      });
      return {
        originalPath: existing,
        thumbPath,
        originalKey,
        thumbKey,
        isNew: false,
        relativeDir: path
          .dirname(path.relative(originalsDir, existing))
          .split(path.sep)
          .join(path.posix.sep)
      };
    }

    const datePath = this.buildDatePath();
    const originalDir = path.join(originalsDir, datePath);
    const thumbDir = path.join(thumbsDir, datePath);

    await fs.mkdir(originalDir, { recursive: true });
    await fs.mkdir(thumbDir, { recursive: true });

    const filename = `${sha}.${ext}`;
    const originalPath = path.join(originalDir, filename);
    const thumbPath = path.join(thumbDir, `${sha}.jpg`);

    const originalKey = path.posix.join('o', datePath, filename);
    const thumbKey = path.posix.join('t', datePath, `${sha}.jpg`);

    this.logger.debug('Allocated storage paths for new media', {
      code: 'media.path.created',
      sha,
      originalKey,
      thumbKey
    });

    return {
      originalPath,
      thumbPath,
      originalKey,
      thumbKey,
      isNew: true,
      relativeDir: datePath
    };
  }

  async findOriginalBySha(sha: string): Promise<{ path: string; extension: string } | null> {
    const {
      directories: { originalsDir }
    } = this.config;

    const matches = await fg(`**/${sha}.*`, {
      cwd: originalsDir,
      onlyFiles: true
    });

    if (!matches.length) {
      return null;
    }

    const relative = matches[0];
    const absolute = path.join(originalsDir, relative);
    const extension = path.extname(absolute).replace('.', '').toLowerCase();

    this.logger.debug('Located original media by SHA', {
      code: 'media.original.found',
      sha,
      extension
    });

    return { path: absolute, extension };
  }

  async getMetadataBySha(sha: string): Promise<MediaMetadataDto> {
    const match = await this.findOriginalBySha(sha);
    if (!match) {
      this.logger.warn('Media metadata not found', {
        code: 'media.metadata.not-found',
        sha
      });
      throw new NotFoundException(`Media with SHA ${sha} not found`);
    }

    const {
      directories: { originalsDir, thumbsDir }
    } = this.config;

    const originalPath = match.path;
    const kind = this.extensionToKind(match.extension);
    const originalKey = this.buildStorageKey(originalPath, originalsDir, 'o');
    const thumbPath = this.deriveThumbPathFromOriginal(originalPath, thumbsDir);
    const thumbKey = this.buildStorageKey(thumbPath, thumbsDir, 't');

    const stats = await fs.stat(originalPath);

    let width: number | null = null;
    let height: number | null = null;
    let durationMs: number | null = null;

    if (kind === 'image') {
      const metadata = await sharp(originalPath).metadata();
      width = metadata.width ?? null;
      height = metadata.height ?? null;
    } else {
      const probe = await this.probeVideo(originalPath);
      width = probe.width ?? null;
      height = probe.height ?? null;
      durationMs = probe.durationSec !== undefined ? Math.round(probe.durationSec * 1000) : null;
    }

    const createdAt = this.extractCreatedAt(originalPath);

    const metadata: MediaMetadataDto = {
      sha256: sha,
      kind,
      mime: this.extensionToMime(match.extension),
      bytes: stats.size,
      width,
      height,
      durationMs,
      storageKeyOriginal: originalKey,
      storageKeyThumb: thumbKey,
      createdAt
    };

    this.logger.info('Returned media metadata', {
      code: 'media.metadata.returned',
      sha,
      kind,
      bytes: stats.size,
      width,
      height,
      durationMs
    });

    return metadata;
  }

  deriveThumbPathFromOriginal(originalPath: string, thumbsDir: string): string {
    const {
      directories: { originalsDir }
    } = this.config;

    const relative = path.relative(originalsDir, originalPath);
    const dir = path.dirname(relative);
    const sha = path.basename(relative, path.extname(relative));
    return path.join(thumbsDir, dir, `${sha}.jpg`);
  }

  private async findExistingOriginal(sha: string, ext: string): Promise<string | null> {
    const {
      directories: { originalsDir }
    } = this.config;

    const pattern = `**/${sha}.${ext}`;
    const matches = await fg(pattern, {
      cwd: originalsDir,
      onlyFiles: true
    });

    if (!matches.length) {
      return null;
    }

    return path.join(originalsDir, matches[0]);
  }

  private buildStorageKey(filePath: string, rootDir: string, prefix: string): string {
    const relative = path.relative(rootDir, filePath).split(path.sep).join(path.posix.sep);
    return path.posix.join(prefix, relative);
  }

  private extensionToKind(ext: string): MediaKind {
    const lower = ext.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp'].includes(lower)) {
      return 'image';
    }
    if (['mp4', 'mov'].includes(lower)) {
      return 'video';
    }
    throw new UnsupportedMediaTypeException(`Unsupported extension ${ext}`);
  }

  private extensionToMime(ext: string): string {
    const lower = ext.toLowerCase();
    switch (lower) {
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'mp4':
        return 'video/mp4';
      case 'mov':
        return 'video/quicktime';
      default:
        throw new UnsupportedMediaTypeException(`Unsupported extension ${ext}`);
    }
  }

  private async probeVideo(filePath: string): Promise<{ durationSec?: number; width?: number; height?: number }> {
    const ffprobePath = ffprobeStatic.path;
    if (!ffprobePath) {
      throw new Error('ffprobe binary not found');
    }

    const { stdout } = await execFileAsync(ffprobePath, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_streams',
      '-show_format',
      filePath
    ]);

    const parsed = JSON.parse(stdout.toString()) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string; width?: number; height?: number }>;
    };

    const durationSec = parsed.format?.duration ? parseFloat(parsed.format.duration) : undefined;
    const videoStream = parsed.streams?.find((stream) => stream.codec_type === 'video');

    const result = {
      durationSec,
      width: videoStream?.width,
      height: videoStream?.height
    };

    this.logger.debug('Probed video metadata', {
      code: 'media.video.probed',
      durationSec: result.durationSec,
      width: result.width,
      height: result.height
    });

    return result;
  }

  private extractCreatedAt(filePath: string): Date | null {
    const {
      directories: { originalsDir }
    } = this.config;

    const relative = path.relative(originalsDir, filePath).split(path.sep);
    if (relative.length < 4) {
      return null;
    }

    const [yearStr, monthStr, dayStr] = relative;
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);

    if ([year, month, day].some((value) => Number.isNaN(value))) {
      return null;
    }

    return new Date(Date.UTC(year, month - 1, day));
  }
}
