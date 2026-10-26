import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseEnumPipe,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../user/enums/role.enum';
import { AppointmentService } from './appointment.service';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { AppointmentStatus } from './enums/appointment-status.enum';

@ApiTags('Reception Appointments')
@Controller('appointments')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.RECEPTIONIST)
@ApiBearerAuth()
export class AppointmentController {
  constructor(private readonly appointments: AppointmentService) {}

  @Get('reception/today')
  @ApiOperation({ summary: 'Receptionist list of appointments scheduled today' })
  @ApiQuery({ name: 'search', required: false, description: 'Appointment code, patient name, or CCCD' })
  @ApiQuery({ name: 'status', required: false, enum: AppointmentStatus })
  listToday(
    @Query('search') search?: string,
    @Query('status', new ParseEnumPipe(AppointmentStatus, { optional: true }))
    status?: AppointmentStatus,
  ) {
    return this.appointments.listToday(search, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Receptionist appointment detail' })
  getById(@Param('id') id: string) {
    return this.appointments.getById(id);
  }

  @Post(':id/reception/check-in')
  @ApiOperation({ summary: 'Check in a booked appointment and issue one Hall ticket atomically' })
  checkIn(
    @Param('id') id: string,
    @Request() req: any,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.appointments.checkIn(id, req.user, idempotencyKey);
  }

  @Put(':id/cancel')
  @ApiOperation({ summary: 'Receptionist cancels a booked appointment with an audit reason' })
  cancel(@Param('id') id: string, @Body() dto: CancelAppointmentDto, @Request() req: any) {
    return this.appointments.cancel(id, dto, req.user);
  }
}
