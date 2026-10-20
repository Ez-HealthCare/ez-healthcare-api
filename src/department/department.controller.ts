import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DepartmentService } from './department.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Departments & Clinics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('departments')
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  @Get()
  @ApiOperation({ summary: 'List all active departments, clinics, and laboratory stations' })
  @ApiResponse({ status: 200, description: 'List of departments retrieved' })
  async findAll() {
    return this.departmentService.findAll();
  }

  @Get('rules/triage')
  @ApiOperation({ summary: 'List clinical triage and screening rules' })
  @ApiResponse({ status: 200, description: 'Triage rules retrieved' })
  async getTriageRules() {
    return this.departmentService.getTriageRules();
  }

  @Get(':code')
  @ApiOperation({ summary: 'Get department details by code' })
  @ApiResponse({ status: 200, description: 'Department details retrieved' })
  @ApiResponse({ status: 404, description: 'Department not found' })
  async findByCode(@Param('code') code: string) {
    return this.departmentService.findByCode(code);
  }
}
