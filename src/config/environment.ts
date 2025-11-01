import * as path from 'node:path';
import { z } from 'zod';

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
    PORT: z.coerce.number().int().positive().default(4000),
    BASE_DIR: z.string().min(1).default('/data/storage'),
    TMP_DIR: z.string().optional(),
    ORIG_DIR: z.string().optional(),
    THUMB_DIR: z.string().optional(),
    MAX_UPLOAD_MB: z.coerce.number().positive().default(50),
    ALLOWED_IMAGE_MIME: z
      .string()
      .default('image/jpeg,image/png,image/webp')
      .transform((value) =>
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      ),
    ALLOWED_VIDEO_MIME: z
      .string()
      .default('video/mp4,video/quicktime')
      .transform((value) =>
        value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      ),
    JWT_PUBLIC_KEY: z.string().min(1).optional(),
    JWT_SHARED_SECRET: z.string().min(1).optional(),
    UPLOAD_TOKEN_SECRET: z.string().min(1).optional(),
    JWT_ALG: z.enum(['RS256', 'HS256']).default('RS256'),
    UPLOAD_TOKEN_TTL_SEC: z.coerce.number().int().positive().default(300),
    THUMB_IMAGE_MAX: z.coerce.number().int().positive().default(512),
    THUMB_VIDEO_WIDTH: z.coerce.number().int().positive().default(512),
    NGINX_CACHE_MAXAGE: z.coerce.number().int().positive().default(31536000),
    REDIS_URL: z.string().optional()
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ALG === 'RS256' && !env.JWT_PUBLIC_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_PUBLIC_KEY'],
        message: 'RS256 requires JWT_PUBLIC_KEY to be set'
      });
    }

    if (env.JWT_ALG === 'HS256') {
      const sharedSecret = env.JWT_SHARED_SECRET ?? env.UPLOAD_TOKEN_SECRET ?? env.JWT_PUBLIC_KEY;
      if (!sharedSecret) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_SHARED_SECRET'],
          message: 'HS256 requires JWT_SHARED_SECRET or UPLOAD_TOKEN_SECRET to be set'
        });
      }
    }
  })
  .transform((env) => {
    const baseDir = env.BASE_DIR;
    const sharedSecret = env.JWT_SHARED_SECRET ?? env.UPLOAD_TOKEN_SECRET ?? null;
    const jwtKey =
      env.JWT_ALG === 'HS256' ? sharedSecret ?? env.JWT_PUBLIC_KEY ?? '' : env.JWT_PUBLIC_KEY ?? '';

    return {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      directories: {
        baseDir,
        tmpDir: env.TMP_DIR ?? path.join(baseDir, 'tmp'),
        originalsDir: env.ORIG_DIR ?? path.join(baseDir, 'o'),
        thumbsDir: env.THUMB_DIR ?? path.join(baseDir, 't')
      },
      maxUploadBytes: Math.round(env.MAX_UPLOAD_MB * 1024 * 1024),
      allowedImageMime: env.ALLOWED_IMAGE_MIME,
      allowedVideoMime: env.ALLOWED_VIDEO_MIME,
      jwt: {
        key: jwtKey,
        algorithm: env.JWT_ALG,
        uploadTokenTtlSec: env.UPLOAD_TOKEN_TTL_SEC
      },
      media: {
        thumbImageMax: env.THUMB_IMAGE_MAX,
        thumbVideoWidth: env.THUMB_VIDEO_WIDTH,
        nginxCacheMaxAge: env.NGINX_CACHE_MAXAGE
      },
      redis: {
        url: env.REDIS_URL ?? null
      }
    };
  });

export type EnvironmentConfig = z.infer<typeof environmentSchema>;

export const validateEnvironment = (config: Record<string, unknown>): EnvironmentConfig => {
  const parsed = environmentSchema.safeParse(config);
  if (!parsed.success) {
    const formatted = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Environment validation error(s): ${formatted.join(', ')}`);
  }
  return parsed.data;
};
