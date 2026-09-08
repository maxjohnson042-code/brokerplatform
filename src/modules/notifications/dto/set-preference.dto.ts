import { IsBoolean, IsIn } from 'class-validator';
import { NOTIFICATION_CATEGORIES } from '../notification-templates';

export class SetPreferenceDto {
  @IsIn(NOTIFICATION_CATEGORIES)
  category!: string;

  @IsBoolean()
  enabled!: boolean;
}
