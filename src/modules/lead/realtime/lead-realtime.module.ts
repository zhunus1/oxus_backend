import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PrismaModule } from "src/database/prisma.module";
import { LeadRealtimeGateway } from "./lead-realtime.gateway";

/** Shares the authenticated Sales and Expert gateway across CRM modules. */
@Module({ imports: [PrismaModule, JwtModule], providers: [LeadRealtimeGateway], exports: [LeadRealtimeGateway] })
export class LeadRealtimeModule {}
