import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class NotificationPageQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  limit = 10;

  @IsIn(['all', 'unread', 'read'])
  filter: 'all' | 'unread' | 'read' = 'all';

  @IsOptional()
  @IsUUID()
  cursor?: string;
}
