import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { defaultImageStorage, extensionFor, mimeTypeForKey } from './image-storage';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const imageInterceptorOptions = {
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    callback(null, ALLOWED_MIME_TYPES.has(file.mimetype));
  },
};

// Mutable, low-sensitivity visual assets (profile photos, org logos) — see
// image-storage.ts's own comment for why this is deliberately separate from
// evidence's write-once compliance documents. GET :key is intentionally public
// (no @UseGuards) — these are visual avatars/logos meant to render in a plain
// <img src>, not documents requiring an access-audit trail.
@Controller('media')
export class MediaController {
  @Post('upload')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', imageInterceptorOptions))
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('file is required (JPEG, PNG or WEBP, up to 5MB)');
    const key = await defaultImageStorage.put(file.buffer, extensionFor(file.mimetype));
    return { url: `/media/${key}` };
  }

  @Get(':key')
  async get(@Param('key') key: string, @Res() res: Response) {
    let buffer: Buffer;
    try {
      buffer = await defaultImageStorage.get(key);
    } catch {
      throw new NotFoundException();
    }
    res.setHeader('Content-Type', mimeTypeForKey(key));
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.send(buffer);
  }
}
