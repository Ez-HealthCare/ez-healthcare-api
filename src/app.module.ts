import { Module } from '@nestjs/common';
import { ApiConfigModule } from './config/api-config.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { DepartmentModule } from './department/department.module';
import { TriageModule } from './triage/triage.module';
import { VisitModule } from './visit/visit.module';
import { ParaclinicalModule } from './paraclinical/paraclinical.module';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './common/audit.module';
import { NotificationModule } from './notification/notification.module';
import { ReceptionRequestModule } from './reception-request/reception-request.module';

@Module({
  imports: [
    ApiConfigModule,
    DatabaseModule,
    AuditModule,
    NotificationModule,
    ReceptionRequestModule,
    AuthModule,
    UserModule,
    DepartmentModule,
    TriageModule,
    VisitModule,
    ParaclinicalModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
