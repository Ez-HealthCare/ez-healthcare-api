import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../database/entities/user.entity';
import { QueueTicket } from '../visit/entities/queue-ticket.entity';
import { Visit } from '../visit/entities/visit.entity';
import { VisitModule } from '../visit/visit.module';
import { ReceptionRequest } from './entities/reception-request.entity';
import { ReceptionRequestController } from './reception-request.controller';
import { ReceptionRequestService } from './reception-request.service';

/**
 * Owns the patient intake request aggregate.
 * Patient requests are issued into the reception Hall queue before desk verification.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ReceptionRequest, User, Visit, QueueTicket]), VisitModule],
  controllers: [ReceptionRequestController],
  providers: [ReceptionRequestService],
  exports: [ReceptionRequestService],
})
export class ReceptionRequestModule {}
