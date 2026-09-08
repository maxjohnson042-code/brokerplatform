import { IsIn, IsOptional, IsString } from 'class-validator';

const STATUSES = ['requested', 'information_required', 'exception_escalated', 'declined', 'pending', 'party_changed_pending'];
const CLASSIFICATIONS = ['new_broker_introducer', 'new_referrer_introducer', 'transfer', 'add_on'];

export class QueueFiltersDto {
  @IsString()
  lenderClientOrganisationId!: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(CLASSIFICATIONS)
  classification?: string;

  @IsOptional()
  @IsString()
  productScope?: string;
}
