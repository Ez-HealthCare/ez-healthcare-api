import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USERNAME', 'postgres'),
        password: configService.get<string>('DB_PASSWORD', 'postgres'),
        database: configService.get<string>('DB_DATABASE', 'tlcn_api_db'),
        autoLoadEntities: true,
        synchronize: configService.get<string>('DB_SYNC') === 'true',
        logging: configService.get<string>('DB_LOGGING') === 'true',
      }),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
