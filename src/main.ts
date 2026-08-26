import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { openApiConfig } from "./configs/openapi.config";
import { ValidationPipe } from "@nestjs/common";
import * as dotenv from "dotenv";
import { useContainer } from "class-validator";
import cookieParser from "cookie-parser";
import { RedisIoAdapter } from "./common/websocket/redis-io.adapter";
import { validateCorsOrigin } from "./configs/cors-origin";

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });
  app.getHttpAdapter().getInstance().set("trust proxy", 1);
  useContainer(app.select(AppModule), { fallbackOnErrors: true });

  app.setGlobalPrefix("api/v1");

  const isStaging = process.env.STAGING?.trim().toLowerCase() === "true";
  if (process.env.NODE_ENV === "production" && !isStaging) {
    app.useLogger(["fatal", "error"]);
  }

  app.enableCors({
    origin: validateCorsOrigin,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  app.use(cookieParser());

  if (process.env.REDIS_URL) {
    try {
      const redisIoAdapter = new RedisIoAdapter(app, process.env.REDIS_URL);
      await redisIoAdapter.connectToRedis();
      app.useWebSocketAdapter(redisIoAdapter);
    } catch (error) {
      console.warn(`Redis WebSocket adapter is unavailable; using the in-memory adapter: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  const options = new DocumentBuilder()
    .setTitle(openApiConfig.title)
    .setDescription(openApiConfig.description)
    .setVersion(openApiConfig.version)
    .addBearerAuth({ name: "Bearer", type: "http" })
    .build();

  const document = SwaggerModule.createDocument(app, options);

  document.paths = Object.keys(document.paths)
    .filter(path => path.startsWith(openApiConfig.prefix) || path === "/")
    .reduce((obj, key) => {
      obj[key] = document.paths[key];
      return obj;
    }, {});

  SwaggerModule.setup(openApiConfig.path, app, document, { swaggerOptions: { persistAuthorization: true } });

  console.log(`API documentation is available at ${openApiConfig.path}`);
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
