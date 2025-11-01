import { Injectable, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import { AppConfigService } from '../config/config.service';
import { hashFile } from '../media/utils/hash.util';
import { MediaService, MediaPathsResult } from '../media/media.service';
import { AppLoggerService, ContextLogger } from '../common/logger/app-logger.service';

const execFileAsync = promisify(execFile);

export interface VideoProcessResult {
  sha: string;
  bytes: number;
  mime: string;
  ext: string;
  width: number;
  height: number;
  durationMs: number;
  paths: MediaPathsResult;
}

export interface VideoNormalizationInput {
  tmpPath: string;
  ext: string;
  mime: string;
  maxDurationSec: number;
}

@Injectable()
export class VideoService {
  private readonly logger: ContextLogger;

  constructor(
    private readonly config: AppConfigService,
    private readonly mediaService: MediaService,
    loggerService: AppLoggerService
  ) {
    this.logger = loggerService.forContext(VideoService.name, { domain: 'video' });
  }

  async processVideo(input: VideoNormalizationInput): Promise<VideoProcessResult> {
    const probe = await this.probe(input.tmpPath);
    const durationSec = probe.durationSec ?? 0;

    if (durationSec > input.maxDurationSec) {
      this.logger.warn('Video duration exceeds limit', {
        code: 'video.duration.exceeded',
        durationSec,
        maxAllowedSec: input.maxDurationSec
      });
      throw new PayloadTooLargeException(
        `Video duration ${durationSec.toFixed(2)}s exceeds allowed ${input.maxDurationSec}s`
      );
    }

    const normalizedExt = this.normalizeExt(input.ext);
    const normalizedMime = this.extToMime(normalizedExt);

    const normalizedPath = await this.stripMetadata(input.tmpPath, normalizedExt);
    const hashResult = await hashFile(normalizedPath);
    const paths = await this.mediaService.resolvePathsForSha(hashResult.sha, normalizedExt);

    if (paths.isNew) {
      await fs.mkdir(path.dirname(paths.originalPath), { recursive: true });
      await fs.copyFile(normalizedPath, paths.originalPath);
      this.logger.debug('Stored normalized video', {
        code: 'video.original.persisted',
        sha: hashResult.sha,
        storageKeyOriginal: paths.originalKey
      });
    } else {
      this.logger.info('Reused existing video original', {
        code: 'video.deduplicated',
        sha: hashResult.sha,
        storageKeyOriginal: paths.originalKey
      });
    }

    if (!(await this.thumbExists(paths.thumbPath))) {
      await fs.mkdir(path.dirname(paths.thumbPath), { recursive: true });
      await this.generateThumbnail(paths.originalPath, paths.thumbPath);
      this.logger.debug('Generated video thumbnail', {
        code: 'video.thumbnail.generated',
        sha: hashResult.sha,
        storageKeyThumb: paths.thumbKey
      });
    }

    await fs.unlink(normalizedPath).catch(() => undefined);

    const fileStats = paths.isNew ? { size: hashResult.bytes } : await fs.stat(paths.originalPath);

    const durationMs = Math.round(durationSec * 1000);

    this.logger.info('Video normalized', {
      code: 'video.processed',
      sha: hashResult.sha,
      mime: normalizedMime,
      ext: normalizedExt,
      bytes: fileStats.size,
      width: probe.width ?? 0,
      height: probe.height ?? 0,
      durationMs,
      deduplicated: !paths.isNew,
      storageKeyOriginal: paths.originalKey,
      storageKeyThumb: paths.thumbKey
    });

    return {
      sha: hashResult.sha,
      bytes: fileStats.size,
      mime: normalizedMime,
      ext: normalizedExt,
      width: probe.width ?? 0,
      height: probe.height ?? 0,
      durationMs,
      paths
    };
  }

  private async probe(filePath: string): Promise<{ durationSec?: number; width?: number; height?: number }> {
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

    return {
      durationSec,
      width: videoStream?.width,
      height: videoStream?.height
    };
  }

  private async stripMetadata(inputPath: string, targetExt: string): Promise<string> {
    const tmpOutput = path.join(path.dirname(inputPath), `${randomUUID()}.${targetExt}`);
    try {
      await this.runFfmpeg([
        '-i',
        inputPath,
        '-map',
        '0',
        '-map_metadata',
        '-1',
        '-c',
        'copy',
        '-y',
        tmpOutput
      ]);
    } catch (error) {
      await fs.unlink(tmpOutput).catch(() => undefined);
      this.logger.warn('Falling back to re-encode during metadata strip', {
        code: 'video.strip.fallback',
        errorMessage: error instanceof Error ? error.message : String(error)
      });
      await this.runFfmpeg([
        '-i',
        inputPath,
        '-map_metadata',
        '-1',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-profile:v',
        'baseline',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        '-y',
        tmpOutput
      ]);
    }

    return tmpOutput;
  }

  private async generateThumbnail(originalPath: string, thumbPath: string): Promise<void> {
    const width = this.config.media.thumbVideoWidth;
    await this.runFfmpeg([
      '-ss',
      '0.5',
      '-i',
      originalPath,
      '-frames:v',
      '1',
      '-vf',
      `scale=${width}:-1`,
      '-q:v',
      '4',
      '-y',
      thumbPath
    ]);
  }

  private async runFfmpeg(args: string[]): Promise<void> {
    const ffmpegPath = ffmpegStatic;
    if (!ffmpegPath) {
      throw new Error('ffmpeg binary not found');
    }
    await execFileAsync(ffmpegPath, args);
  }

  private async thumbExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private normalizeExt(ext: string): 'mp4' | 'mov' {
    const lower = ext.toLowerCase();
    if (lower === 'mp4') {
      return 'mp4';
    }
    if (lower === 'mov') {
      return 'mov';
    }
    throw new UnsupportedMediaTypeException(`Unsupported video extension ${ext}`);
  }

  private extToMime(ext: string): string {
    switch (ext) {
      case 'mp4':
        return 'video/mp4';
      case 'mov':
        return 'video/quicktime';
      default:
        throw new UnsupportedMediaTypeException(`Unsupported video extension ${ext}`);
    }
  }
}
