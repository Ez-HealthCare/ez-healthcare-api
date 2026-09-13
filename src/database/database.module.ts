import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiConfigService } from '../core/services/api-config.service';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ApiConfigService],
      useFactory: (apiConfig: ApiConfigService) => ({
        type: apiConfig.dbType,
        host: apiConfig.dbHost,
        port: apiConfig.dbPort,
        username: apiConfig.dbUsername,
        password: apiConfig.dbPassword,
        database: apiConfig.dbDatabase,
        autoLoadEntities: true,
        synchronize: apiConfig.dbSync,
        logging: apiConfig.dbLogging,
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
