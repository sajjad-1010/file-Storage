import { Injectable, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AppConfigService } from './config.service';

@Injectable()
export class StorageInitializerService implements OnModuleInit {
  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    const {
      directories: { baseDir, tmpDir, originalsDir, thumbsDir }
    } = this.config;

    const uniquePaths = new Set([baseDir, tmpDir, originalsDir, thumbsDir]);
    await Promise.all(
      Array.from(uniquePaths).map((dirPath) => this.ensureDir(dirPath))
    );
  }

  private async ensureDir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
    const resolved = await fs.realpath(dirPath);
    if (!resolved.startsWith(path.resolve(dirPath))) {
      throw new Error(`Invalid directory path resolution for ${dirPath}`);
    }
  }
}
