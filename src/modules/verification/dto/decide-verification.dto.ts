import { IsIn } from 'class-validator';

export class DecideVerificationDto {
  @IsIn(['approve', 'decline'])
  decision!: 'approve' | 'decline';
}
