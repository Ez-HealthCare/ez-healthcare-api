import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { VisitService } from './visit.service';
import { TriageDagService } from '../triage/triage-dag.service';
import { CreateHallTicketDto } from './dto/create-hall-ticket.dto';
import { VerifyVisitDto, RejectVerificationDto } from './dto/verify-visit.dto';
import { AssignClinicDto } from './dto/assign-clinic.dto';
import { RecordVitalsDto } from './dto/record-vitals.dto';
import { EmergencyDispatchDto, TransferClinicDto } from './dto/transfer-clinic.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ConcludeVisitDto } from './dto/conclude-visit.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../user/enums/role.enum';

@ApiTags('Outpatient Clinical Visits')
@Controller('visits')
export class VisitController {
  constructor(
    private readonly visitService: VisitService,
    private readonly triageDagService: TriageDagService,
  ) {}

  /**
   * Self-service kiosk OR reception desk check-in.
   * No mandatory auth — anonymous patients at the kiosk may check in,
   * but a logged-in patient token is also accepted (OptionalJwtGuard).
   */
  @Post('hall-ticket')
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Issue Hall Ticket (A-xxx) for self-service or reception check-in' })
  @ApiResponse({
    status: 201,
    description: 'Hall Ticket issued successfully with HALL_WAITING status',
  })
  @ApiResponse({ status: 409, description: 'Patient already has an active visit ticket for today' })
  async createHallTicket(@Body() dto: CreateHallTicketDto, @Request() req: any) {
    return this.visitService.createHallTicket(dto, req?.user);
  }

  /**
   * Reception verifies physical National ID + Insurance card documents.
   * RECEPTIONIST and ADMIN only.
   */
  @Put(':id/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEPTIONIST, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reception: audit physical National ID & Insurance card' })
  @ApiResponse({
    status: 200,
    description: 'Patient identity verified, transitions to RECEPTION_VERIFIED',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: requires RECEPTIONIST or ADMIN role' })
  async verifyVisit(@Param('id') id: string, @Body() dto: VerifyVisitDto, @Request() req: any) {
    return this.visitService.verifyVisit(id, dto, req.user?.id);
  }

  @Put(':id/reject-verification')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEPTIONIST, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reception: reject verification due to fraudulent or mismatching credentials',
  })
  @ApiResponse({ status: 200, description: 'Visit cancelled and removed from active queues' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: requires RECEPTIONIST or ADMIN role' })
  async rejectVerification(
    @Param('id') id: string,
    @Body() dto: RejectVerificationDto,
    @Request() req: any,
  ) {
    return this.visitService.rejectVerification(id, dto, req.user?.id);
  }

  @Post(':id/assign-clinic')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEPTIONIST, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reception: assign specialty clinic ticket (HH-xx) with quota and priority check',
  })
  @ApiResponse({
    status: 200,
    description: 'Clinic ticket assigned, transitions to TRIAGE_PENDING',
  })
  @ApiResponse({ status: 409, description: 'Clinic has reached its maximum shift quota' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: requires RECEPTIONIST or ADMIN role' })
  async assignClinic(@Param('id') id: string, @Body() dto: AssignClinicDto, @Request() req: any) {
    return this.visitService.assignClinic(id, dto, req.user?.id);
  }

  @Post(':id/vitals')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.NURSE, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Nurse: record 5 mandatory vital signs (BP, HR, Temp, SpO2, RespRate)' })
  @ApiResponse({
    status: 201,
    description:
      'Vitals recorded; routes to CLINIC_WAITING or STAT EMERGENCY_DISPATCHED if SpO2 < 90%',
  })
  @ApiResponse({ status: 400, description: 'Mandatory vital sign omitted' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: requires NURSE or ADMIN role' })
  async recordVitals(@Param('id') id: string, @Body() dto: RecordVitalsDto, @Request() req: any) {
    return this.visitService.recordVitalSigns(id, dto, req.user?.id);
  }

  @Post(':id/emergency-dispatch')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.NURSE, Role.DOCTOR, Role.RECEPTIONIST, Role.EMERGENCY_STAFF, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Trigger STAT emergency dispatch to P.001 resuscitation unit' })
  @ApiResponse({ status: 200, description: 'Emergency dispatch protocol activated' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: clinical staff only' })
  async emergencyDispatch(
    @Param('id') id: string,
    @Body() dto: EmergencyDispatchDto,
    @Request() req: any,
  ) {
    return this.visitService.emergencyDispatch(id, dto, req.user?.id);
  }

  @Put(':id/call')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DOCTOR, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Doctor calls next waiting patient into consultation room' })
  @ApiResponse({ status: 200, description: 'Visit status transitions to IN_EXAMINATION' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: requires DOCTOR or ADMIN role' })
  async callPatient(@Param('id') id: string, @Request() req: any) {
    return this.visitService.callPatient(id, req.user?.id);
  }

  @Post(':id/transfer')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DOCTOR, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Transfer patient to alternate specialty consultation clinic' })
  @ApiResponse({ status: 200, description: 'Patient transferred with preserved clinical notes' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: requires DOCTOR or ADMIN role' })
  async transferClinic(
    @Param('id') id: string,
    @Body() dto: TransferClinicDto,
    @Request() req: any,
  ) {
    return this.visitService.transferClinic(id, dto, req.user?.id);
  }

  @Post(':id/orders')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DOCTOR, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Formulate diagnostic orders evaluated by Kahn DAG algorithm' })
  @ApiResponse({
    status: 201,
    description: 'Diagnostic steps created and topological route generated',
  })
  @ApiResponse({ status: 400, description: 'Vital signs missing or cyclic dependency detected' })
  @ApiResponse({
    status: 422,
    description: 'Radiation safety hazard detected for suspected pregnancy',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: requires DOCTOR or ADMIN role' })
  async processOrders(@Param('id') id: string, @Body() dto: CreateOrderDto, @Request() req: any) {
    return this.triageDagService.processClinicalOrders(id, req.user?.id, dto);
  }

  @Post(':id/conclusion')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DOCTOR, Role.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Final ICD-10 diagnosis, electronic prescription, and discharge' })
  @ApiResponse({
    status: 200,
    description: 'Visit marked COMPLETED with digitally signed prescription',
  })
  @ApiResponse({
    status: 422,
    description: 'Patient documented drug allergy contraindication triggered',
  })
  @ApiResponse({ status: 409, description: 'Visit already completed' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: requires DOCTOR or ADMIN role' })
  async concludeVisit(@Param('id') id: string, @Body() dto: ConcludeVisitDto, @Request() req: any) {
    return this.visitService.concludeVisit(id, dto, req.user?.id);
  }

  /**
   * Optimized route — accessible to authenticated staff AND to the patient
   * whose visit it belongs to.  Anonymous public access is NOT allowed.
   */
  @Get(':id/route')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.NURSE, Role.LAB_TECHNICIAN, Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Retrieve optimized multi-floor routing path with wait time heuristics',
  })
  @ApiResponse({ status: 200, description: 'Topological station route returned successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getRoute(@Param('id') id: string) {
    return this.visitService.getRoute(id);
  }

  /**
   * Real-time clinic queue — restricted to clinical staff.
   * Returns patient names and vitals; not suitable for public display.
   */
  @Get('queue/:departmentCode')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.NURSE, Role.LAB_TECHNICIAN)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Real-time patient queue for a specific clinic or diagnostic station (staff only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Active queue returned sorted by priority and arrival time',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: clinical staff only' })
  async getQueue(@Param('departmentCode') departmentCode: string) {
    return this.visitService.getQueue(departmentCode);
  }

  /**
   * Full visit dossier — role-aware PII exposure.
   * ADMIN/RECEPTIONIST: sees nationalId + insuranceCardNumber.
   * DOCTOR/NURSE/LAB_TECHNICIAN: sees clinical fields, no PII.
   * PATIENT: may only retrieve their own visit.
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.ADMIN, Role.RECEPTIONIST, Role.DOCTOR, Role.NURSE, Role.LAB_TECHNICIAN, Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Retrieve full visit dossier including vitals, orders, steps, and prescription',
  })
  @ApiResponse({
    status: 200,
    description: 'Visit dossier retrieved (PII fields limited by caller role)',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Patients may only access their own visits' })
  @ApiResponse({ status: 404, description: 'Visit not found' })
  async getVisitDetails(@Param('id') id: string, @Request() req: any) {
    const callerRole: Role = req.user?.role;
    const callerId: string = req.user?.id;
    const includePatientPii = [Role.ADMIN, Role.RECEPTIONIST].includes(callerRole);
    return this.visitService.getVisitDetails(id, callerId, callerRole, includePatientPii);
  }
}
