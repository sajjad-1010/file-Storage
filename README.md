# File Storage Service

Streaming-oriented NestJS microservice for receiving media uploads, normalising images/videos, and storing originals & thumbnails on disk behind Nginx/CDN.

## Features
- JWT-protected `POST /upload` endpoint with streaming multipart ingestion.
- Automatic normalisation: EXIF orientation fix & metadata stripping for images; metadata stripping and duration enforcement for videos.
- Deduplication via SHA-256 on normalised originals; reused storage keys for duplicate uploads.
- Separate originals (`/o/...`) and thumbnails (`/t/...`) directories for Nginx serving.
- Structured logging, environment validation with `zod`, optional Redis locks.

## Getting Started
1. **Install dependencies**
   ```bash
   npm install
   ```
2. **Copy environment template**
   ```bash
   cp .env.example .env
   ```
   Fill in the JWT key, directories, and other values as needed.
3. **Prepare storage directories** (will also be auto-created on boot)
   ```bash
   mkdir -p storage/tmp storage/o storage/t
   ```
4. **Run in development**
   ```bash
   npm run dev
   ```
   Or build & start:
   ```bash
   npm run build
   npm start
   ```

## Available Scripts
- `npm run dev` — start NestJS in watch mode.
- `npm run build` — compile TypeScript to `dist`.
- `npm start` — run the compiled app.
- `npm run lint` — eslint with TypeScript rules.
- `npm test` — execute Jest test suite.
- `npm run cleanup:tmp` — remove temporary files older than 24h.
- `npm run verify:thumbs` — ensure thumbnails exist for each original.

## API Overview
Endpoint details live in `docs/endpoints.md`; Postman collection is available at `docs/file-storage.postman_collection.json`.

## Nginx Front
Example vhost configuration is provided in `docs/nginx.conf.sample`.

## Docker
Container build and docker-compose samples are provided in `docs/docker/`.
