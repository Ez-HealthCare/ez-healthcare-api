import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Role } from '../user/enums/role.enum';
import { SaveReceptionRequestDraftDto } from './dto/save-reception-request-draft.dto';
import { ReceptionRequestService } from './reception-request.service';

@ApiTags('Patient Reception Requests')
@Controller('reception-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.PATIENT)
@ApiBearerAuth()
export class ReceptionRequestController {
  constructor(private readonly requests: ReceptionRequestService) {}

  @Get('me/current')
  @ApiOperation({ summary: 'Get the patient\'s current reception request, if any' })
  getMyCurrent(@Request() req: any) {
    return this.requests.getMyCurrent(req.user.id);
  }

  @Put('me/draft')
  @ApiOperation({ summary: 'Create or update the patient\'s incomplete reception request' })
  saveDraft(@Request() req: any, @Body() dto: SaveReceptionRequestDraftDto) {
    return this.requests.saveDraft(req.user.id, dto);
  }

  @Post('me/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit the saved request for receptionist verification' })
  submit(@Request() req: any) {
    return this.requests.submit(req.user.id);
  }

  @Put('me/cancel')
  @ApiOperation({ summary: 'Cancel the patient\'s active draft or pending request' })
  cancelMyCurrent(@Request() req: any) {
    return this.requests.cancelMyCurrent(req.user.id);
  }
}
