import { Controller, Post, Req } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { UploadResponseDto } from '../media/dto/upload-response.dto';
import { UploadAuthService } from './upload-auth.service';
import { UploadService } from './upload.service';

@Controller()
export class UploadController {
  constructor(
    private readonly uploadAuth: UploadAuthService,
    private readonly uploadService: UploadService
  ) {}

  @Post('upload')
  async upload(@Req() request: FastifyRequest): Promise<UploadResponseDto> {
    const token = this.uploadAuth.verifyAuthorizationHeader(request.headers.authorization);
    return this.uploadService.handleUpload(request, token);
  }
}
