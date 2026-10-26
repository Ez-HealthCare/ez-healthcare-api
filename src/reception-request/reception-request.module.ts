import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../database/entities/user.entity';
import { QueueTicket } from '../visit/entities/queue-ticket.entity';
import { Visit } from '../visit/entities/visit.entity';
import { ReceptionRequest } from './entities/reception-request.entity';
import { ReceptionRequestController } from './reception-request.controller';
import { ReceptionRequestService } from './reception-request.service';

/**
 * Owns the patient intake request aggregate.
 * It exposes Patient APIs now; Receptionist processing is added separately.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ReceptionRequest, User, Visit, QueueTicket])],
  controllers: [ReceptionRequestController],
  providers: [ReceptionRequestService],
  exports: [ReceptionRequestService],
})
export class ReceptionRequestModule {}
