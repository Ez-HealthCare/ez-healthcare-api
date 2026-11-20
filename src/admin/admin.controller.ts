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
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AdminService } from './admin.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';
import { UpdateStaffUserDto } from './dto/update-staff-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { AdminUsersQueryDto } from './dto/admin-users-query.dto';
import { AdminReportsQueryDto } from './dto/admin-reports-query.dto';
import { AdminAuditQueryDto } from './dto/admin-audit-query.dto';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { CreateTriageRuleDto } from './dto/create-triage-rule.dto';
import { UpdateTriageRuleDto } from './dto/update-triage-rule.dto';
import { CreateReceptionShiftDto } from './dto/create-reception-shift.dto';
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
  // SCHEDULE MANAGEMENT (DOCTORS)
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
  // RECEPTION DESK SHIFTS
  // ---------------------------------------------------------

  @Get('reception-shifts')
  @ApiOperation({ summary: 'Admin: list reception desk assignments' })
  @ApiQuery({ name: 'businessDate', required: false, description: 'YYYY-MM-DD' })
  @ApiResponse({ status: 200, description: 'List of reception shifts' })
  async listReceptionShifts(@Query('businessDate') businessDate?: string) {
    return this.adminService.listReceptionShifts(businessDate);
  }

  @Post('reception-shifts')
  @ApiOperation({ summary: 'Admin: assign receptionist to desk' })
  @ApiResponse({ status: 201, description: 'Receptionist desk shift assigned' })
  @ApiResponse({ status: 409, description: 'Desk or staff collision' })
  async createReceptionShift(@Body() dto: CreateReceptionShiftDto, @Request() req: any) {
    return this.adminService.createReceptionShift(dto, req.user);
  }

  @Delete('reception-shifts/:id')
  @ApiOperation({ summary: 'Admin: remove receptionist desk assignment' })
  @ApiResponse({ status: 200, description: 'Reception shift removed' })
  @ApiResponse({ status: 404, description: 'Shift not found' })
  async deleteReceptionShift(@Param('id') id: string, @Request() req: any) {
    return this.adminService.deleteReceptionShift(id, req.user);
  }

  // ---------------------------------------------------------
  // CONFIGURATIONS
  // ---------------------------------------------------------

  @Get('configs')
  @ApiOperation({ summary: 'Admin: retrieve dynamic system configurations' })
  @ApiResponse({ status: 200, description: 'System configurations retrieved' })
  async getConfigs() {
    return this.adminService.getConfigs();
  }

  @Put('configs/:key')
  @ApiOperation({ summary: 'Admin: update dynamic system configuration parameter' })
  @ApiResponse({ status: 200, description: 'Configuration updated successfully' })
  @ApiResponse({ status: 404, description: 'Configuration key not found' })
  async updateConfig(
    @Param('key') key: string,
    @Body() dto: UpdateSystemConfigDto,
    @Request() req: any,
  ) {
    return this.adminService.updateConfig(key, dto, req.user);
  }

  // ---------------------------------------------------------
  // TRIAGE RULES MANAGEMENT
  // ---------------------------------------------------------

  @Get('triage-rules')
  @ApiOperation({ summary: 'Admin: list clinical triage routing rules' })
  @ApiResponse({ status: 200, description: 'List of triage rules' })
  async listTriageRules() {
    return this.adminService.listTriageRules();
  }

  @Post('triage-rules')
  @ApiOperation({ summary: 'Admin: create new clinical triage rule' })
  @ApiResponse({ status: 201, description: 'Triage rule created' })
  @ApiResponse({ status: 409, description: 'Symptom code already exists' })
  async createTriageRule(@Body() dto: CreateTriageRuleDto, @Request() req: any) {
    return this.adminService.createTriageRule(dto, req.user);
  }

  @Put('triage-rules/:id')
  @ApiOperation({ summary: 'Admin: update clinical triage rule' })
  @ApiResponse({ status: 200, description: 'Triage rule updated' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async updateTriageRule(
    @Param('id') id: string,
    @Body() dto: UpdateTriageRuleDto,
    @Request() req: any,
  ) {
    return this.adminService.updateTriageRule(id, dto, req.user);
  }

  @Delete('triage-rules/:id')
  @ApiOperation({ summary: 'Admin: delete clinical triage rule' })
  @ApiResponse({ status: 200, description: 'Triage rule deleted' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async deleteTriageRule(@Param('id') id: string, @Request() req: any) {
    return this.adminService.deleteTriageRule(id, req.user);
  }

  // ---------------------------------------------------------
  // AUDIT TRAIL / ACTIVITY LOGS
  // ---------------------------------------------------------

  @Get('audit-logs')
  @ApiOperation({ summary: 'Admin: retrieve paginated system activity trail' })
  @ApiResponse({ status: 200, description: 'Paginated activity log list' })
  async listAuditLogs(@Query() query: AdminAuditQueryDto) {
    return this.adminService.listAuditLogs(query);
  }

  // ---------------------------------------------------------
  // HOSPITAL ANALYTICS & REPORTS
  // ---------------------------------------------------------

  @Get('reports/summary')
  @ApiOperation({ summary: 'Admin: visit flow summary and status breakdown' })
  @ApiResponse({ status: 200, description: 'Aggregated visit counts and emergency rate' })
  async getReportSummary(@Query() query: AdminReportsQueryDto) {
    return this.adminService.getReportSummary(query);
  }

  @Get('reports/departments')
  @ApiOperation({ summary: 'Admin: department patient distribution and completion rates' })
  @ApiResponse({ status: 200, description: 'Department performance metrics' })
  async getDepartmentReports(@Query() query: AdminReportsQueryDto) {
    return this.adminService.getDepartmentReports(query);
  }

  @Get('reports/eta-performance')
  @ApiOperation({ summary: 'Admin: reception queue ETA forecasting accuracy and MAE analysis' })
  @ApiResponse({ status: 200, description: 'ETA error distribution and metrics' })
  async getEtaPerformance(@Query() query: AdminReportsQueryDto) {
    return this.adminService.getEtaPerformance(query);
  }

  @Get('reports/triage-risk')
  @ApiOperation({ summary: 'Admin: NEWS2 risk breakdown and emergency red-flag prevalence' })
  @ApiResponse({ status: 200, description: 'Triage vital risk distributions' })
  async getTriageRiskReport(@Query() query: AdminReportsQueryDto) {
    return this.adminService.getTriageRiskReport(query);
  }

  @Get('reports/export')
  @ApiOperation({
    summary: 'Admin: export operational visit and triage dataset to Excel-ready CSV',
  })
  @ApiResponse({ status: 200, description: 'Streamable CSV file' })
  async exportReport(@Query() query: AdminReportsQueryDto, @Res() res: Response) {
    const csv = await this.adminService.exportReportCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=ez_healthcare_visits_report.csv');
    res.send(csv);
  }
}
