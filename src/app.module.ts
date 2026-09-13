import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { APP_CONSTANTS } from './common/constants/app.constants';
import { ENV_KEYS } from './common/constants/env.constants';
import { CoreModule } from './core/core.module';
import { DatabaseModule } from './database/database.module';
import { UserModule } from './user/user.module';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    CoreModule,
    DatabaseModule,
    UserModule,
    AuthModule,
    ObserveModule.forRoot({
      appKey: process.env[ENV_KEYS.OBSERVE_APP_KEY] || APP_CONSTANTS.OBSERVE_DEFAULT_APP_KEY,
      appSecret:
        process.env[ENV_KEYS.OBSERVE_APP_SECRET] || APP_CONSTANTS.OBSERVE_DEFAULT_APP_SECRET,
      serviceId: APP_CONSTANTS.GLOBAL_PREFIX,
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
