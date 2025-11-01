import { Controller, Get, Param } from '@nestjs/common';
import { MediaMetadataDto } from './dto/media-metadata.dto';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get(':sha/meta')
  async getMetadata(@Param('sha') sha: string): Promise<MediaMetadataDto> {
    return this.mediaService.getMetadataBySha(sha);
  }
}
