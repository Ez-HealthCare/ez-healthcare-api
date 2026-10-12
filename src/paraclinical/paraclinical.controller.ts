import { Body, Controller, Get, Param, Post, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ParaclinicalService } from './paraclinical.service';
import { SubmitResultDto } from './dto/submit-result.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../user/enums/role.enum';

@ApiTags('Paraclinical LIS & PACS Stations')
@Controller('paraclinical')
export class ParaclinicalController {
  constructor(private readonly paraclinicalService: ParaclinicalService) {}

  @Get('worklist')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.LAB_TECHNICIAN, Role.DOCTOR, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Laboratory & Imaging worklist by station or department' })
  @ApiQuery({
    name: 'departmentCode',
    required: false,
    description: 'Filter by department code (e.g. P.201, P.104)',
  })
  @ApiResponse({ status: 200, description: 'Worklist items retrieved' })
  async getWorklist(@Query('departmentCode') departmentCode?: string) {
    return this.paraclinicalService.getWorklist(departmentCode);
  }

  @Post(':stepId/result')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.LAB_TECHNICIAN, Role.DOCTOR, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Technician: submit, sign and approve diagnostic findings and panic alerts',
  })
  @ApiResponse({
    status: 201,
    description: 'Diagnostic result recorded. If 100% completed, auto-recalls patient to clinic.',
  })
  @ApiResponse({ status: 404, description: 'Paraclinical order step not found' })
  async submitResult(
    @Param('stepId') stepId: string,
    @Body() dto: SubmitResultDto,
    @Request() req: any,
  ) {
    return this.paraclinicalService.submitResult(stepId, dto, req.user?.id);
  }

  @Get(':stepId/result')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.LAB_TECHNICIAN, Role.DOCTOR, Role.NURSE, Role.ADMIN, Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Retrieve diagnostic result for a completed visit step' })
  @ApiResponse({ status: 200, description: 'Diagnostic result details retrieved' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({
    status: 403,
    description: 'Forbidden: clinical staff or the attending patient only',
  })
  @ApiResponse({ status: 404, description: 'Result not found' })
  async getResult(@Param('stepId') stepId: string) {
    return this.paraclinicalService.getResult(stepId);
  }
}
