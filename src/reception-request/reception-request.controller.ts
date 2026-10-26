import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../user/enums/role.enum';
import { SaveReceptionRequestDraftDto } from './dto/save-reception-request-draft.dto';
import { RejectReceptionRequestDto } from './dto/reject-reception-request.dto';
import { ReceptionRequestService } from './reception-request.service';

@ApiTags('Patient Reception Requests')
@Controller('reception-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ReceptionRequestController {
  constructor(private readonly requests: ReceptionRequestService) {}

  @Get('reception/pending')
  @Roles(Role.RECEPTIONIST)
  @ApiOperation({ summary: 'List requests awaiting receptionist verification' })
  listPending(@Query('search') search?: string) {
    return this.requests.listPending(search);
  }

  @Post('reception/:id/confirm')
  @Roles(Role.RECEPTIONIST)
  @ApiOperation({ summary: 'Issue one Hall ticket for a submitted request atomically' })
  confirm(@Param('id') id: string, @Request() req: any) {
    return this.requests.confirm(id, req.user);
  }

  @Put('reception/:id/reject')
  @Roles(Role.RECEPTIONIST)
  @ApiOperation({ summary: 'Reject a submitted request with an administrative reason' })
  reject(@Param('id') id: string, @Body() dto: RejectReceptionRequestDto, @Request() req: any) {
    return this.requests.reject(id, dto.reason, req.user);
  }

  @Get('me/current')
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'Get the patient\'s current reception request, if any' })
  getMyCurrent(@Request() req: any) {
    return this.requests.getMyCurrent(req.user.id);
  }

  @Put('me/draft')
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'Create or update the patient\'s incomplete reception request' })
  saveDraft(@Request() req: any, @Body() dto: SaveReceptionRequestDraftDto) {
    return this.requests.saveDraft(req.user.id, dto);
  }

  @Post('me/submit')
  @Roles(Role.PATIENT)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit the saved request for receptionist verification' })
  submit(@Request() req: any) {
    return this.requests.submit(req.user.id);
  }

  @Put('me/cancel')
  @Roles(Role.PATIENT)
  @ApiOperation({ summary: 'Cancel the patient\'s active draft or pending request' })
  cancelMyCurrent(@Request() req: any) {
    return this.requests.cancelMyCurrent(req.user.id);
  }
}
