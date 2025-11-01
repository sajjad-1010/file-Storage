import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';

export const hashBuffer = (buffer: Buffer): string => {
  return createHash('sha256').update(buffer).digest('hex');
};

export const hashFile = async (filePath: string): Promise<{ sha: string; bytes: number }> => {
  const hash = createHash('sha256');
  let totalBytes = 0;

  const stream = createReadStream(filePath);
  for await (const chunk of stream) {
    const buffer = chunk as Buffer;
    totalBytes += buffer.length;
    hash.update(buffer);
  }

  return { sha: hash.digest('hex'), bytes: totalBytes };
};

export const bufferSize = async (filePath: string): Promise<number> => {
  const stat = await fs.stat(filePath);
  return stat.size;
};
