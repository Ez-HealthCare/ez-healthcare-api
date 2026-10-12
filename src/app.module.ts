import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DatabaseModule,
    AuditModule,
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
