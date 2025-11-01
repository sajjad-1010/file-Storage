import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { ImageService } from './image.service';

@Module({
  imports: [MediaModule],
  providers: [ImageService],
  exports: [ImageService]
})
export class ImageModule {}
