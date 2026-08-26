import { Module } from "@nestjs/common";
import { RedisService } from "./redis.service";
import { ConfigService } from "@nestjs/config";

@Module({
  exports: [RedisService],
  providers: [RedisService, ConfigService],
})
export class RedisModule {}
