export type MediaKind = 'image' | 'video';

export interface UploadTokenPayload {
  sub: string;
  kind: MediaKind;
  maxSize?: number | null;
  postId?: string | null;
  maxVideoSec?: number;
  exp: number;
}
