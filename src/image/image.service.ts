import { Injectable, UnsupportedMediaTypeException } from '@nestjs/common';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import sharp from 'sharp';
import { AppConfigService } from '../config/config.service';
import { hashBuffer } from '../media/utils/hash.util';
import { MediaService, MediaPathsResult } from '../media/media.service';
import { AppLoggerService, ContextLogger } from '../common/logger/app-logger.service';

export interface ImageProcessResult {
  sha: string;
  bytes: number;
  mime: string;
  ext: string;
  width: number;
  height: number;
  paths: MediaPathsResult;
}

export interface ImageNormalizationInput {
  tmpPath: string;
  ext: string;
  mime: string;
  shaHint?: string;
}

@Injectable()
export class ImageService {
  private readonly logger: ContextLogger;

  constructor(
    private readonly config: AppConfigService,
    private readonly mediaService: MediaService,
    loggerService: AppLoggerService
  ) {
    this.logger = loggerService.forContext(ImageService.name, { domain: 'image' });
  }

  async processImage(input: ImageNormalizationInput): Promise<ImageProcessResult> {
    const normalized = await this.normalize(input.tmpPath, input.ext);
    const sha = hashBuffer(normalized.data);
    const paths = await this.mediaService.resolvePathsForSha(sha, normalized.ext);

    if (paths.isNew) {
      await fs.mkdir(path.dirname(paths.originalPath), { recursive: true });
      await fs.writeFile(paths.originalPath, normalized.data);
    }

    const fileStats = paths.isNew
      ? { size: normalized.data.length }
      : await fs.stat(paths.originalPath);

    if (!(await this.thumbExists(paths.thumbPath))) {
      await fs.mkdir(path.dirname(paths.thumbPath), { recursive: true });
      await this.generateThumbnail(normalized.data, paths.thumbPath);
      this.logger.debug('Generated image thumbnail', {
        code: 'image.thumbnail.generated',
        sha,
        storageKeyThumb: paths.thumbKey
      });
    }

    const infoWidth = normalized.info.width ?? 0;
    const infoHeight = normalized.info.height ?? 0;

    this.logger.info('Image normalized', {
      code: 'image.processed',
      sha,
      mime: normalized.mime,
      ext: normalized.ext,
      bytes: fileStats.size,
      width: infoWidth,
      height: infoHeight,
      deduplicated: !paths.isNew,
      storageKeyOriginal: paths.originalKey,
      storageKeyThumb: paths.thumbKey
    });

    return {
      sha,
      bytes: fileStats.size,
      mime: normalized.mime,
      ext: normalized.ext,
      width: infoWidth,
      height: infoHeight,
      paths
    };
  }

  private async normalize(tmpPath: string, ext: string) {
    const normalizedExt = this.normalizeExt(ext);
    const pipeline = sharp(tmpPath, { failOnError: false }).rotate();

    switch (normalizedExt) {
      case 'jpg':
        pipeline.jpeg({ quality: 94, chromaSubsampling: '4:4:4', mozjpeg: true });
        break;
      case 'png':
        pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
        break;
      case 'webp':
        pipeline.webp({ quality: 92, effort: 4 });
        break;
      default:
        throw new UnsupportedMediaTypeException(`Unsupported image extension ${ext}`);
    }

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      data,
      info,
      ext: normalizedExt,
      mime: this.extToMime(normalizedExt)
    };
  }

  private async generateThumbnail(buffer: Buffer, thumbPath: string): Promise<void> {
    const maxSide = this.config.media.thumbImageMax;
    const thumb = sharp(buffer).resize({
      width: maxSide,
      height: maxSide,
      fit: 'inside',
      withoutEnlargement: true
    });

    const thumbBuffer = await thumb.jpeg({ quality: 82 }).toBuffer();
    await fs.writeFile(thumbPath, thumbBuffer);
  }

  private async thumbExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private normalizeExt(ext: string): 'jpg' | 'png' | 'webp' {
    const lower = ext.toLowerCase();
    if (lower === 'jpg' || lower === 'jpeg') {
      return 'jpg';
    }
    if (lower === 'png') {
      return 'png';
    }
    if (lower === 'webp') {
      return 'webp';
    }
    throw new UnsupportedMediaTypeException(`Unsupported image extension ${ext}`);
  }

  private extToMime(ext: string): string {
    switch (ext) {
      case 'jpg':
        return 'image/jpeg';
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      default:
        throw new UnsupportedMediaTypeException(`Unsupported image extension ${ext}`);
    }
  }
}
