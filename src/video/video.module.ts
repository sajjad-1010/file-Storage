import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { VideoService } from './video.service';

@Module({
  imports: [MediaModule],
  providers: [VideoService],
  exports: [VideoService]
})
export class VideoModule {}
