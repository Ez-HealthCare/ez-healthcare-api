import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../user/enums/role.enum';

@ApiTags('System Administration & Catalogs')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post('departments')
  @ApiOperation({ summary: 'Admin: add new department or consultation clinic room catalog' })
  @ApiResponse({ status: 201, description: 'Department room registered successfully' })
  @ApiResponse({ status: 409, description: 'Department code already exists' })
  async createDepartment(@Body() dto: CreateDepartmentDto) {
    return this.adminService.createDepartment(dto);
  }

  @Post('schedules')
  @ApiOperation({ summary: 'Admin: assign doctor shift and shift capacity quota' })
  @ApiResponse({ status: 201, description: 'Doctor schedule assigned successfully' })
  @ApiResponse({ status: 409, description: 'Doctor schedule collision on same shift' })
  async createSchedule(@Body() dto: CreateScheduleDto) {
    return this.adminService.createSchedule(dto);
  }

  @Get('configs')
  @ApiOperation({ summary: 'Admin: retrieve dynamic system configurations and routing weights' })
  @ApiResponse({ status: 200, description: 'System configurations retrieved' })
  async getConfigs() {
    return this.adminService.getConfigs();
  }
}
