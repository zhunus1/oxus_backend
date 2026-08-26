import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { CreateLeadDto } from "../api/dto/create-lead.dto";
import { LeadEntity } from "../api/dto/lead.entity";

@Injectable()
export class LeadRepository extends BaseRepository {
  async create(data: CreateLeadDto): Promise<LeadEntity> {
    const lead = await this.prisma.lead.create({ data });
    return new LeadEntity(lead);
  }

  async findAll(): Promise<LeadEntity[]> {
    const leads = await this.prisma.lead.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        contactedByUser: {
          select: { id: true, firstname: true, lastname: true },
        },
      },
    });
    return leads.map(lead => new LeadEntity(lead));
  }

  async markContacted(id: number, expertUserId: number): Promise<LeadEntity> {
    // Toggle: if already contacted, unmark; otherwise mark
    const existing = await this.prisma.lead.findUnique({ where: { id } });
    const nowContacted = !existing?.isContacted;
    const lead = await this.prisma.lead.update({
      where: { id },
      data: {
        isContacted: nowContacted,
        contactedAt: nowContacted ? new Date() : null,
        contactedByUserId: nowContacted ? expertUserId : null,
      },
      include: {
        contactedByUser: {
          select: { id: true, firstname: true, lastname: true },
        },
      },
    });
    return new LeadEntity(lead);
  }
}
