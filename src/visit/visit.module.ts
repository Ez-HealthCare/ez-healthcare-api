import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Visit } from './entities/visit.entity';
import { VisitVital } from './entities/visit-vital.entity';
import { VisitOrder } from './entities/visit-order.entity';
import { VisitStep } from './entities/visit-step.entity';
import { Department } from '../department/entities/department.entity';
import { User } from '../database/entities/user.entity';
import { Prescription } from '../prescription/entities/prescription.entity';
import { PrescriptionItem } from '../prescription/entities/prescription-item.entity';
import { VisitService } from './visit.service';
import { VisitController } from './visit.controller';
import { TriageModule } from '../triage/triage.module';
import { DoctorSchedule } from '../department/entities/doctor-schedule.entity';
import { QueueCounter } from './entities/queue-counter.entity';
import { QueueTicket } from './entities/queue-ticket.entity';
import { NotificationModule } from '../notification/notification.module';
import { QueueTicketService } from './queue-ticket.service';
import { ReceptionService } from './reception.service';
import { ClinicQueueService } from './clinic-queue.service';
import { Appointment } from '../appointment/entities/appointment.entity';
import { AppointmentService } from '../appointment/appointment.service';
import { AppointmentController } from '../appointment/appointment.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Visit,
      VisitVital,
      VisitOrder,
      VisitStep,
      Department,
      User,
      Prescription,
      PrescriptionItem,
      DoctorSchedule,
      QueueCounter,
      QueueTicket,
      Appointment,
    ]),
    TriageModule,
    NotificationModule,
  ],
  controllers: [VisitController, AppointmentController],
  providers: [
    VisitService,
    QueueTicketService,
    ReceptionService,
    ClinicQueueService,
    AppointmentService,
  ],
  exports: [VisitService, QueueTicketService, ReceptionService, ClinicQueueService],
})
export class VisitModule {}
