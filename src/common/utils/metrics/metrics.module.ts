import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { MetricsService } from "./metrics.service";
import { MetricsMiddleware } from "./metrics.middleware";

@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(MetricsMiddleware).forRoutes("");
  }
}
