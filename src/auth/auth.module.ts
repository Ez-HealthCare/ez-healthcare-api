import { Global, Module } from '@nestjs/common';
import { ApiConfigModule } from '../config/api-config.module';
import { ApiConfigService } from '../config/api-config.service';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../database/entities/user.entity';
import { PatientOtp } from './entities/patient-otp.entity';
import { AuthSession } from './entities/auth-session.entity';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RolesGuard } from './guards/roles.guard';
import { ACCESS_SECONDS } from '../common/constants/auth.constants';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([User, PatientOtp, AuthSession]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ApiConfigModule],
      inject: [ApiConfigService],
      useFactory: (config: ApiConfigService) => ({
        secret: config.jwtSecret,
        signOptions: { expiresIn: ACCESS_SECONDS },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, RolesGuard],
  exports: [AuthService, PassportModule, JwtModule, RolesGuard],
})
export class AuthModule {}
