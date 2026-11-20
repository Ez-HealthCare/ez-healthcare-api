import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Department } from '../department/entities/department.entity';
import { DoctorSchedule } from '../department/entities/doctor-schedule.entity';
import { SystemConfig } from './entities/system-config.entity';
import { User } from '../database/entities/user.entity';
import { AuthSession } from '../auth/entities/auth-session.entity';
import { AuditLog } from '../common/entities/audit-log.entity';
import { TriageRule } from '../triage/entities/triage-rule.entity';
import { Visit } from '../visit/entities/visit.entity';
import { VisitVital } from '../visit/entities/visit-vital.entity';
import { ReceptionEtaForecast } from '../visit/entities/reception-eta-forecast.entity';
import { ReceptionDeskShift } from '../visit/entities/reception-desk-shift.entity';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Department,
      DoctorSchedule,
      SystemConfig,
      User,
      AuthSession,
      AuditLog,
      TriageRule,
      Visit,
      VisitVital,
      ReceptionEtaForecast,
      ReceptionDeskShift,
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
