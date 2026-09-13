import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule, ObserveInstrument } from './app.module';
import { APP_CONSTANTS } from './common/constants/app.constants';
import { ApiConfigService } from './core/services/api-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });

  const apiConfigService = app.get(ApiConfigService);

  // Enable CORS
  app.enableCors({
    origin: apiConfigService.frontendUrl ?? true,
    credentials: true,
  });

  // Global prefix
  app.setGlobalPrefix(APP_CONSTANTS.GLOBAL_PREFIX);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle(APP_CONSTANTS.SWAGGER_TITLE)
    .setDescription(APP_CONSTANTS.SWAGGER_DESCRIPTION)
    .setVersion(APP_CONSTANTS.SWAGGER_VERSION)
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(APP_CONSTANTS.SWAGGER_DOCS_PATH, app, document);

  const port = apiConfigService.port;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}/${APP_CONSTANTS.GLOBAL_PREFIX}`);
  console.log(`Swagger documentation: http://localhost:${port}/${APP_CONSTANTS.SWAGGER_DOCS_PATH}`);
}
bootstrap();
