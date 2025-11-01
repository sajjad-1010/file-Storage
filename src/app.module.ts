import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { CommonModule } from './common/common.module';
import { UploadModule } from './upload/upload.module';
import { ImageModule } from './image/image.module';
import { VideoModule } from './video/video.module';
import { MediaModule } from './media/media.module';
import { TasksModule } from './tasks/tasks.module';

@Module({
  imports: [
    AppConfigModule,
    CommonModule,
    MediaModule,
    ImageModule,
    VideoModule,
    UploadModule,
    TasksModule
  ]
})
export class AppModule {}
