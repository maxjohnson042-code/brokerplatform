import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Res,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../identity/guards/jwt-auth.guard';
import { CurrentAuthContext } from '../identity/decorators/current-auth-context.decorator';
import { AuthorizationContext } from '../../db/authorization-context';
import * as repo from './evidence.repository';
import { getBusiness } from '../businesses/businesses.repository';
import { UploadDocumentDto } from './dto/upload-document.dto';

const MAX_FILE_BYTES = 15 * 1024 * 1024; // DOC-008
const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']);

const fileInterceptorOptions = {
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: (
    _req: unknown,
    file: Express.Multer.File,
    callback: (error: Error | null, acceptFile: boolean) => void,
  ) => {
    callback(null, ALLOWED_MIME_TYPES.has(file.mimetype));
  },
};

// DOC-001/002/006/007/008: document upload, versioning, outstanding-item tracking.
// Extends the same EvidenceModule Epic 1 scaffolded for the verification pipeline's
// storeEvidence() — this is the first HTTP surface on that table. download() also
// carries AUD-007's access logging (see getDocumentForDownload's own comment).
@Controller('documents')
@UseGuards(JwtAuthGuard)
export class EvidenceController {
  private requireBroker(ctx: AuthorizationContext): string {
    if (ctx.actorType !== 'broker') throw new UnauthorizedException();
    return ctx.actorId;
  }

  @Post('broker-profile')
  @UseInterceptors(FileInterceptor('file', fileInterceptorOptions))
  async uploadForProfile(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const brokerProfileId = this.requireBroker(ctx);
    if (!file) throw new BadRequestException('file is required (PDF, JPEG, PNG or HEIC, up to 15MB)');
    const { id } = await repo.uploadDocument({
      subjectType: 'broker_profile',
      subjectId: brokerProfileId,
      documentType: dto.documentType,
      file: file.buffer,
      mimeType: file.mimetype,
      originalFilename: file.originalname,
      issueDate: dto.issueDate,
      expiryDate: dto.expiryDate,
      issuingBody: dto.issuingBody,
      uploadedBy: { actorType: 'broker', actorId: brokerProfileId },
    });
    return { id };
  }

  @Get('broker-profile')
  async listForProfile(@CurrentAuthContext() ctx: AuthorizationContext) {
    const brokerProfileId = this.requireBroker(ctx);
    return repo.listCurrentDocuments(ctx, 'broker_profile', brokerProfileId);
  }

  @Get('broker-profile/outstanding-items')
  async outstandingForProfile(@CurrentAuthContext() ctx: AuthorizationContext) {
    const brokerProfileId = this.requireBroker(ctx);
    return repo.getOutstandingDocumentItems(ctx, 'broker_profile', brokerProfileId);
  }

  @Post('businesses/:businessId')
  @UseInterceptors(FileInterceptor('file', fileInterceptorOptions))
  async uploadForBusiness(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('businessId') businessId: string,
    @Body() dto: UploadDocumentDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const brokerProfileId = this.requireBroker(ctx);
    if (!file) throw new BadRequestException('file is required (PDF, JPEG, PNG or HEIC, up to 15MB)');

    // getBusiness's own RLS (the fixed broker_businesses_visibility, migration 0019)
    // is what actually proves the caller holds an active affiliation — a broker with
    // none, or only a pending one, gets null back here, same as everywhere else this
    // check is needed.
    const business = await getBusiness(ctx, businessId);
    if (!business) throw new NotFoundException();
    if (business.status !== 'draft' && business.status !== 'attention_required') {
      throw new ForbiddenException(`documents cannot be added while business status is '${business.status}'`);
    }

    const { id } = await repo.uploadDocument({
      subjectType: 'broker_business',
      subjectId: businessId,
      documentType: dto.documentType,
      file: file.buffer,
      mimeType: file.mimetype,
      originalFilename: file.originalname,
      issueDate: dto.issueDate,
      expiryDate: dto.expiryDate,
      issuingBody: dto.issuingBody,
      uploadedBy: { actorType: 'broker', actorId: brokerProfileId },
    });
    return { id };
  }

  @Get('businesses/:businessId')
  async listForBusiness(@CurrentAuthContext() ctx: AuthorizationContext, @Param('businessId') businessId: string) {
    return repo.listCurrentDocuments(ctx, 'broker_business', businessId);
  }

  @Get('businesses/:businessId/outstanding-items')
  async outstandingForBusiness(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('businessId') businessId: string,
  ) {
    return repo.getOutstandingDocumentItems(ctx, 'broker_business', businessId);
  }

  @Get(':evidenceId/download')
  async download(
    @CurrentAuthContext() ctx: AuthorizationContext,
    @Param('evidenceId') evidenceId: string,
    @Res() res: Response,
  ) {
    const document = await repo.getDocumentForDownload(ctx, evidenceId);
    if (!document) throw new NotFoundException();
    res.setHeader('Content-Type', document.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${document.originalFilename}"`);
    res.send(document.buffer);
  }
}
