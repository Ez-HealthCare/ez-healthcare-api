import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { VisitService } from './visit.service';
import { TriageDagService } from '../triage/triage-dag.service';
import { CreateHallTicketDto, CreateWalkInTicketDto } from './dto/create-hall-ticket.dto';
import { VerifyVisitDto, RejectVerificationDto } from './dto/verify-visit.dto';
import { AssignClinicDto } from './dto/assign-clinic.dto';
import { RecordIntakeDto } from './dto/record-intake.dto';
import { PauseHallTicketDto, ReissueTicketDto, RequeueVisitDto } from './dto/queue-action.dto';
import { EmergencyDispatchDto, TransferClinicDto } from './dto/transfer-clinic.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ConcludeVisitDto } from './dto/conclude-visit.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../user/enums/role.enum';
import { QueueTicketService } from './queue-ticket.service';
import { ReceptionService } from './reception.service';
import { ClinicQueueService } from './clinic-queue.service';

@ApiTags('Outpatient Clinical Visits')
@Controller('visits')
export class VisitController {
  constructor(
    private readonly visitService: VisitService,
    private readonly queueTicketService: QueueTicketService,
    private readonly receptionService: ReceptionService,
    private readonly clinicQueueService: ClinicQueueService,
    private readonly triageDagService: TriageDagService,
  ) {}

  @Post('hall-ticket')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Patient requests a facility-wide Hall Ticket (A-xxx)' })
  @ApiResponse({
    status: 201,
    description: 'Hall Ticket issued successfully with HALL_WAITING status',
  })
  @ApiResponse({ status: 409, description: 'Patient already has an active visit ticket for today' })
  async createHallTicket(
    @Body() dto: CreateHallTicketDto,
    @Request() req: any,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.queueTicketService.createHallTicket(dto, req.user, idempotencyKey);
  }

  @Post('reception/walk-in')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEPTIONIST)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reception creates a hall ticket for an existing walk-in patient' })
  createWalkInTicket(
    @Body() dto: CreateWalkInTicketDto,
    @Request() req: any,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.queueTicketService.createWalkInTicket(dto, req.user, idempotencyKey);
  }

  @Get('me/current')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PATIENT)
  @ApiBearerAuth()
  getMyCurrentVisit(@Request() req: any) {
    return this.receptionService.getMyCurrentVisit(req.user.id);
  }

  @Get('reception/queue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.NURSE, Role.RECEPTIONIST)
  @ApiBearerAuth()
  getReceptionQueue() {
    return this.receptionService.getReceptionQueue();
  }

  @Get('reception/expired')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.NURSE, Role.RECEPTIONIST)
  @ApiBearerAuth()
  getExpiredReceptionQueue(@Query('businessDate') businessDate?: string) {
    return this.receptionService.getExpiredReceptionQueue(businessDate);
  }

  @Put(':id/reception/call')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEPTIONIST)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reception calls a patient holding an active hall ticket' })
  callHallTicket(@Param('id') id: string, @Request() req: any) {
    return this.receptionService.callHallTicket(id, req.user);
  }

  @Put(':id/reception/pause')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEPTIONIST)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reception temporarily skips an active hall ticket' })
  pauseHallTicket(
    @Param('id') id: string,
    @Body() dto: PauseHallTicketDto,
    @Request() req: any,
  ) {
    return this.receptionService.pauseHallTicket(id, dto, req.user);
  }

  @Put(':id/reception/recall')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEPTIONIST)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reception restores and calls a paused hall ticket' })
  recallHallTicket(@Param('id') id: string, @Request() req: any) {
    return this.receptionService.recallHallTicket(id, req.user);
  }

  @Get('doctor/rooms')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  getDoctorRooms(@Request() req: any) {
    return this.clinicQueueService.getDoctorRooms(req.user.id);
  }

  /**
   * Reception verifies physical National ID + Insurance card documents.
   * RECEPTIONIST and ADMIN only.
   */
  @Put(':id/verify')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEPTIONIST, Role.NURSE)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reception: audit physical National ID & Insurance card' })
  @ApiResponse({
    status: 200,
    description: 'Patient identity verified, transitions to RECEPTION_VERIFIED',
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: requires RECEPTIONIST or ADMIN role' })
  async verifyVisit(@Param('id') id: string, @Body() dto: VerifyVisitDto, @Request() req: any) {
    return this.receptionService.verifyVisit(id, dto, req.user);
  }

  @Put(':id/reject-verification')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEPTIONIST, Role.NURSE)
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
    return this.receptionService.rejectVerification(id, dto, req.user);
  }

  @Post(':id/assign-clinic')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEPTIONIST, Role.NURSE)
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
  async assignClinic(
    @Param('id') id: string,
    @Body() dto: AssignClinicDto,
    @Request() req: any,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.receptionService.assignClinic(id, dto, req.user, idempotencyKey);
  }

  @Put(':id/intake')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.NURSE, Role.RECEPTIONIST)
  @ApiBearerAuth()
  recordIntake(@Param('id') id: string, @Body() dto: RecordIntakeDto, @Request() req: any) {
    return this.receptionService.recordIntake(id, dto, req.user);
  }

  @Post(':id/reissue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.PATIENT, Role.NURSE, Role.RECEPTIONIST)
  @ApiBearerAuth()
  reissueTicket(
    @Param('id') id: string,
    @Body() dto: ReissueTicketDto,
    @Request() req: any,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.queueTicketService.reissueTicket(id, dto, req.user, idempotencyKey);
  }

  @Post(':id/emergency-dispatch')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.NURSE, Role.DOCTOR, Role.RECEPTIONIST)
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
    return this.visitService.emergencyDispatch(id, dto, req.user);
  }

  @Put(':id/call')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Doctor calls next waiting patient into consultation room' })
  @ApiResponse({ status: 200, description: 'Visit status transitions to IN_EXAMINATION' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: requires DOCTOR or ADMIN role' })
  async callPatient(@Param('id') id: string, @Request() req: any) {
    return this.clinicQueueService.callPatient(id, req.user.id);
  }

  @Post(':id/start-exam')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  startExamination(@Param('id') id: string, @Request() req: any) {
    return this.clinicQueueService.startExamination(id, req.user.id);
  }

  @Post(':id/requeue')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.NURSE, Role.RECEPTIONIST)
  @ApiBearerAuth()
  requeueVisit(@Param('id') id: string, @Body() dto: RequeueVisitDto, @Request() req: any) {
    return this.clinicQueueService.requeueVisit(id, dto, req.user);
  }

  @Post(':id/transfer')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DOCTOR)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Transfer patient to alternate specialty consultation clinic' })
  @ApiResponse({ status: 200, description: 'Patient transferred with preserved clinical notes' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden: requires DOCTOR or ADMIN role' })
  async transferClinic(
    @Param('id') id: string,
    @Body() dto: TransferClinicDto,
    @Request() req: any,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.clinicQueueService.transferClinic(id, dto, req.user, idempotencyKey);
  }

  @Post(':id/orders')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.DOCTOR)
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
  @Roles(Role.DOCTOR)
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
  @Roles(Role.RECEPTIONIST, Role.DOCTOR, Role.NURSE, Role.PATIENT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Retrieve optimized multi-floor routing path with wait time heuristics',
  })
  @ApiResponse({ status: 200, description: 'Topological station route returned successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getRoute(@Param('id') id: string, @Request() req: any) {
    return this.visitService.getRoute(id, req.user.id, req.user.role);
  }

  /**
   * Real-time clinic queue — restricted to clinical staff.
   * Returns patient names and vitals; not suitable for public display.
   */
  @Get('queue/:departmentCode')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEPTIONIST, Role.DOCTOR, Role.NURSE)
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
  async getQueue(@Param('departmentCode') departmentCode: string, @Request() req: any) {
    return this.clinicQueueService.getQueue(departmentCode, req.user);
  }

  /**
   * Full visit dossier — role-aware PII exposure.
   * ADMIN/RECEPTIONIST: sees nationalId + insuranceCardNumber.
   * DOCTOR/NURSE/LAB_TECHNICIAN: sees clinical fields, no PII.
   * PATIENT: may only retrieve their own visit.
   */
  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(Role.RECEPTIONIST, Role.DOCTOR, Role.NURSE, Role.PATIENT)
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
    const includePatientPii = [Role.RECEPTIONIST, Role.NURSE].includes(callerRole);
    return this.visitService.getVisitDetails(id, callerId, callerRole, includePatientPii);
  }
}
