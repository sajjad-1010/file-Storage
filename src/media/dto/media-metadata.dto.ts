import { MediaKind } from '../types/upload-token.type';

export class MediaMetadataDto {
  sha256!: string;
  kind!: MediaKind;
  mime!: string;
  bytes!: number;
  width!: number | null;
  height!: number | null;
  durationMs!: number | null;
  storageKeyOriginal!: string;
  storageKeyThumb!: string;
  createdAt!: Date | null;
}
