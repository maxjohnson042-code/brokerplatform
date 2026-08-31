import { IsEmail, IsString, MinLength } from 'class-validator';

// Used only by scripts/seed-platform-admin.ts — there is no HTTP endpoint that accepts
// this DTO, deliberately (see the bootstrap-gap note in identity.module.ts).
export class CreatePlatformAdminDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}
