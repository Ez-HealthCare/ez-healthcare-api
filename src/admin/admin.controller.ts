import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';
import { UpdateStaffUserDto } from './dto/update-staff-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
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

  // ---------------------------------------------------------
  // STATS & OVERVIEW
  // ---------------------------------------------------------

  @Get('stats')
  @ApiOperation({ summary: 'Admin: retrieve system overview statistics' })
  @ApiResponse({ status: 200, description: 'Aggregated admin stats' })
  async getStats() {
    return this.adminService.getAdminStats();
  }

  // ---------------------------------------------------------
  // USER MANAGEMENT
  // ---------------------------------------------------------

  @Get('users')
  @ApiOperation({ summary: 'Admin: list hospital users with filters and pagination' })
  @ApiResponse({ status: 200, description: 'Paginated user list' })
  async listUsers(@Query() query: AdminUsersQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Post('users')
  @ApiOperation({ summary: 'Admin: create a new staff account' })
  @ApiResponse({ status: 201, description: 'Staff account created successfully' })
  @ApiResponse({ status: 409, description: 'Email, phone, or CCCD already in use' })
  async createStaffUser(@Body() dto: CreateStaffUserDto, @Request() req: any) {
    return this.adminService.createStaffUser(dto, req.user);
  }

  @Get('users/:id')
  @ApiOperation({ summary: 'Admin: get user details by ID' })
  @ApiResponse({ status: 200, description: 'User details' })
  @ApiResponse({ status: 404, description: 'User not found' })
  async getUserById(@Param('id') id: string) {
    return this.adminService.getUserById(id);
  }

  @Put('users/:id')
  @ApiOperation({ summary: 'Admin: update staff user information' })
  @ApiResponse({ status: 200, description: 'Staff user updated' })
  @ApiResponse({ status: 404, description: 'User not found' })
  @ApiResponse({ status: 409, description: 'Phone or CCCD collision' })
  async updateStaffUser(
    @Param('id') id: string,
    @Body() dto: UpdateStaffUserDto,
    @Request() req: any,
  ) {
    return this.adminService.updateStaffUser(id, dto, req.user);
  }

  @Patch('users/:id/status')
  @ApiOperation({ summary: 'Admin: activate or deactivate staff account' })
  @ApiResponse({ status: 200, description: 'User status updated' })
  async toggleUserStatus(
    @Param('id') id: string,
    @Body('isActive') isActive: boolean,
    @Request() req: any,
  ) {
    return this.adminService.toggleUserStatus(id, !!isActive, req.user);
  }

  @Post('users/:id/reset-password')
  @ApiOperation({ summary: 'Admin: reset password for a staff member' })
  @ApiResponse({ status: 200, description: 'Password reset and sessions revoked' })
  async resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto, @Request() req: any) {
    return this.adminService.resetPassword(id, dto, req.user);
  }

  // ---------------------------------------------------------
  // DEPARTMENT MANAGEMENT
  // ---------------------------------------------------------

  @Get('departments')
  @ApiOperation({ summary: 'Admin: retrieve all clinic and lab departments' })
  @ApiResponse({ status: 200, description: 'List of all departments' })
  async listDepartments() {
    return this.adminService.listDepartments();
  }

  @Post('departments')
  @ApiOperation({ summary: 'Admin: add new department or consultation clinic room catalog' })
  @ApiResponse({ status: 201, description: 'Department room registered successfully' })
  @ApiResponse({ status: 409, description: 'Department code already exists' })
  async createDepartment(@Body() dto: CreateDepartmentDto) {
    return this.adminService.createDepartment(dto);
  }

  @Put('departments/:id')
  @ApiOperation({ summary: 'Admin: update department configuration' })
  @ApiResponse({ status: 200, description: 'Department updated successfully' })
  @ApiResponse({ status: 404, description: 'Department not found' })
  async updateDepartment(
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
    @Request() req: any,
  ) {
    return this.adminService.updateDepartment(id, dto, req.user);
  }

  // ---------------------------------------------------------
  // SCHEDULE MANAGEMENT
  // ---------------------------------------------------------

  @Get('schedules')
  @ApiOperation({ summary: 'Admin: list doctor schedules' })
  @ApiQuery({ name: 'shiftDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'departmentCode', required: false, description: 'P.101' })
  @ApiResponse({ status: 200, description: 'List of doctor schedules' })
  async listSchedules(
    @Query('shiftDate') shiftDate?: string,
    @Query('departmentCode') departmentCode?: string,
  ) {
    return this.adminService.listSchedules(shiftDate, departmentCode);
  }

  @Post('schedules')
  @ApiOperation({ summary: 'Admin: assign doctor shift and shift capacity quota' })
  @ApiResponse({ status: 201, description: 'Doctor schedule assigned successfully' })
  @ApiResponse({ status: 409, description: 'Doctor schedule collision on same shift' })
  async createSchedule(@Body() dto: CreateScheduleDto) {
    return this.adminService.createSchedule(dto);
  }

  @Delete('schedules/:id')
  @ApiOperation({ summary: 'Admin: remove doctor schedule assignment' })
  @ApiResponse({ status: 200, description: 'Doctor schedule removed' })
  @ApiResponse({ status: 404, description: 'Schedule not found' })
  async deleteSchedule(@Param('id') id: string, @Request() req: any) {
    return this.adminService.deleteSchedule(id, req.user);
  }

  // ---------------------------------------------------------
  // CONFIGURATIONS
  // ---------------------------------------------------------

  @Get('configs')
  @ApiOperation({ summary: 'Admin: retrieve dynamic system configurations and routing weights' })
  @ApiResponse({ status: 200, description: 'System configurations retrieved' })
  async getConfigs() {
    return this.adminService.getConfigs();
  }
}
