import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureAuthHttp } from './auth/configure-auth-http';
import { API_PREFIX, SWAGGER_PATH } from './common/constants/app.constants';
import { ApiConfigService } from './config/api-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const apiConfig = app.get(ApiConfigService);
  configureAuthHttp(app, apiConfig);

  // Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle('API Documentation')
    .setDescription('Backend API service documentation')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(SWAGGER_PATH, app, document);

  const port = apiConfig.port;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}/${API_PREFIX}`);
  console.log(`Swagger documentation: http://localhost:${port}/${SWAGGER_PATH}`);
}
bootstrap();
