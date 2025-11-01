import { Module } from '@nestjs/common';
import { ImageModule } from '../image/image.module';
import { MediaModule } from '../media/media.module';
import { VideoModule } from '../video/video.module';
import { UploadController } from './upload.controller';
import { UploadAuthService } from './upload-auth.service';
import { UploadService } from './upload.service';

@Module({
  imports: [ImageModule, VideoModule, MediaModule],
  controllers: [UploadController],
  providers: [UploadService, UploadAuthService]
})
export class UploadModule {}
