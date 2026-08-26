import { Injectable } from "@nestjs/common";
import { BaseRepository } from "src/database/prisma.repository";
import { LeadEntity } from "../api/dto/lead.entity";
import { LEAD_SOURCE } from "../domain/lead.constants";

@Injectable()
export class LeadRepository extends BaseRepository {
  async findAll(): Promise<LeadEntity[]> {
    const leads = await this.prisma.lead.findMany({
      where: { originSource: { code: LEAD_SOURCE.LEGACY_CONTACT_FORM }, deletedAt: null },
      orderBy: { createdAt: "desc" },
      include: {
        contactedByUser: {
          select: { id: true, firstname: true, lastname: true },
        },
      },
    });
    return leads.map(lead => new LeadEntity(lead));
  }

  async markContacted(id: number, expertUserId: number): Promise<LeadEntity | null> {
    // Toggle: if already contacted, unmark; otherwise mark
    const existing = await this.prisma.lead.findFirst({
      where: { id, originSource: { code: LEAD_SOURCE.LEGACY_CONTACT_FORM }, deletedAt: null },
    });
    if (!existing) return null;
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
