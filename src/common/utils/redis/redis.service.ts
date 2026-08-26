import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createClient, RedisClientType } from "redis";

@Injectable()
export class RedisService implements OnModuleInit {
  private client: RedisClientType;
  private readonly logger = new Logger(RedisService.name);

  constructor(private readonly configService: ConfigService) {
    this.client = createClient({
      url: this.configService.get<string>("REDIS_URL"),
    });
    this.client.on("error", () => {
      this.logger.error("Error while connecting to Redis");
    });
  }

  async onModuleInit() {
    await this.client.connect();
    this.logger.log("Successfully connected to Redis");
  }

  async incr(key: string) {
    return await this.client.incr(key);
  }

  async decr(key: string) {
    return await this.client.decr(key);
  }

  async exists(key: string) {
    return await this.client.exists(key);
  }

  async expire(key: string, seconds: number) {
    return await this.client.expire(key, seconds);
  }

  async get(key: string) {
    return await this.client.get(key);
  }

  async ttl(key: string): Promise<number> {
    return await this.client.ttl(key);
  }

  async set(key: string, value: string) {
    return await this.client.set(key, value);
  }

  async incrBy(key: string, increment: number) {
    return await this.client.incrBy(key, increment);
  }

  async setEx(key: string, value: string, seconds: number) {
    return await this.client.setEx(key, seconds, value);
  }

  async del(key: string) {
    return await this.client.del(key);
  }
}
