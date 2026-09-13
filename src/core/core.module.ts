import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ApiConfigService, ApiService } from './services/api-config.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [ApiConfigService, ApiService],
  exports: [ApiConfigService, ApiService],
})
export class CoreModule {}
