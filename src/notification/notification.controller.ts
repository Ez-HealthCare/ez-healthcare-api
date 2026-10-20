import { Controller, Get, Param, Patch, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@Request() req: any) {
    return this.notifications.list(req.user.id);
  }

  @Patch('read-all')
  markAllRead(@Request() req: any) {
    return this.notifications.markAllRead(req.user.id);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string, @Request() req: any) {
    return this.notifications.markRead(id, req.user.id);
  }
}
