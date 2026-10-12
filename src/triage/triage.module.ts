import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TriageRule } from './entities/triage-rule.entity';
import { Department } from '../department/entities/department.entity';
import { Visit } from '../visit/entities/visit.entity';
import { VisitOrder } from '../visit/entities/visit-order.entity';
import { VisitStep } from '../visit/entities/visit-step.entity';
import { TriageController } from './triage.controller';
import { TriageDagService } from './triage-dag.service';

@Module({
  imports: [TypeOrmModule.forFeature([TriageRule, Department, Visit, VisitOrder, VisitStep])],
  controllers: [TriageController],
  providers: [TriageDagService],
  exports: [TriageDagService],
})
export class TriageModule {}
