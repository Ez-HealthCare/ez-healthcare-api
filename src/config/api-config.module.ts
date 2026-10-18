import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApiConfigService } from './api-config.service';

@Global()
@Module({
  imports: [ConfigModule.forRoot({ envFilePath: '.env' })],
  providers: [
    {
      provide: ApiConfigService,
      inject: [ConfigService],
      useFactory: (env: ConfigService) => {
        const config = new ApiConfigService(env);
        config.validate();
        return config;
      },
    },
  ],
  exports: [ApiConfigService],
})
export class ApiConfigModule {}
