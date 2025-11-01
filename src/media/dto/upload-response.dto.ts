import { MediaKind } from '../types/upload-token.type';

export class UploadResponseDto {
  mediaId!: string;
  ownerId!: string;
  kind!: MediaKind;
  mime!: string;
  bytes!: number;
  width!: number;
  height!: number;
  durationMs!: number | null;
  storageKeyOriginal!: string;
  storageKeyThumb!: string;
  sha256!: string;
  status!: 'ready';
}
