import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ParaclinicalResult } from './entities/paraclinical-result.entity';
import { VisitStep } from '../visit/entities/visit-step.entity';
import { Visit } from '../visit/entities/visit.entity';
import { Department } from '../department/entities/department.entity';
import { ParaclinicalService } from './paraclinical.service';
import { ParaclinicalController } from './paraclinical.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ParaclinicalResult, VisitStep, Visit, Department])],
  controllers: [ParaclinicalController],
  providers: [ParaclinicalService],
  exports: [ParaclinicalService],
})
export class ParaclinicalModule {}
