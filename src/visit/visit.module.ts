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
    ]),
    TriageModule,
  ],
  controllers: [VisitController],
  providers: [VisitService],
  exports: [VisitService],
})
export class VisitModule {}
