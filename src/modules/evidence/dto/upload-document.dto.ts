import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';
import { DOCUMENT_CATALOG } from '../document-catalog';

const DOCUMENT_TYPES = DOCUMENT_CATALOG.map((entry) => entry.documentType);

// Multipart body fields alongside the `file` field itself — multer/NestJS deliver
// these as strings regardless of the DTO's declared type, same as any form post.
export class UploadDocumentDto {
  @IsIn(DOCUMENT_TYPES)
  documentType!: string;

  @IsOptional()
  @IsISO8601()
  issueDate?: string;

  @IsOptional()
  @IsISO8601()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  issuingBody?: string;
}
