import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "src/database/prisma.service";
import { normalizePhoneNumber } from "src/modules/lead/domain/phone-number";
import { LEAD_PERMISSION } from "src/modules/lead/domain/lead.constants";
import { WazzupClient } from "./wazzup.client";
import type { WazzupContact, WazzupIframeRequest } from "./wazzup.client";

// Bound both database work and the number of contacts embedded in a session.
const MAX_SALES_CHATS = 1000;

@Injectable()
export class WazzupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: WazzupClient,
    private readonly config: ConfigService,
  ) {}

  async channels(actorId: number) {
    const actor = await this.actor(actorId);
    if (!actor.isAdmin) throw new ForbiddenException("Only administrators can list Wazzup channels");
    return this.client.channels();
  }

  async globalIframe(actorId: number) {
    const actor = await this.actor(actorId);
    if (actor.isAdmin) return this.issue(actorId, actor.isAdmin, { user: actor.user, scope: "global" });
    const leads = await this.prisma.lead.findMany({
      where: { assignedSalesManagerId: actorId, acceptedAt: { not: null }, deletedAt: null, phoneNumber: { not: null } },
      select: { id: true, phoneNumber: true, displayName: true },
      orderBy: { id: "asc" },
      take: MAX_SALES_CHATS + 1,
    });
    if (leads.length > MAX_SALES_CHATS) {
      throw new ConflictException({ code: "WAZZUP_CHAT_LIMIT", message: "Too many leads for one chat window; open a lead card" });
    }
    const contacts = leads.flatMap(lead => {
      const contact = this.contact(lead, actor.user.id);
      return contact ? [contact] : [];
    });
    if (!contacts.length) throw new ConflictException({ code: "WAZZUP_NO_CHATS", message: "No assigned leads with valid phone numbers" });
    const chats = [...new Map(contacts.map(contact => [contact.contactData[0].chatId, { ...contact.contactData[0], name: contact.name }])).values()];
    // A global Wazzup window can also expose unassigned incoming chats. Sales
    // therefore receives a card-scoped session containing only current CRM phones.
    return this.issue(actorId, actor.isAdmin, { user: actor.user, scope: "card", filter: chats }, contacts, leads);
  }

  async leadIframe(actorId: number, leadId: number) {
    const actor = await this.actor(actorId);
    if (!Number.isInteger(leadId) || leadId <= 0 || leadId > 2_147_483_647) throw new BadRequestException("Invalid lead ID");
    const lead = await this.prisma.lead.findFirst({
      where: { id: leadId, deletedAt: null, ...(actor.isAdmin ? {} : { assignedSalesManagerId: actorId, acceptedAt: { not: null } }) },
      select: { id: true, phoneNumber: true, displayName: true },
    });
    if (!lead) throw new NotFoundException("Lead not found");
    const contact = this.contact(lead, actor.user.id);
    if (!contact) throw new BadRequestException({ code: "WAZZUP_INVALID_PHONE", message: "Lead must have a valid phone number" });
    const chat = { ...contact.contactData[0], name: contact.name };
    const channelId = this.config.get<string>("WAZZUP_CHANNEL_ID", "").trim();
    return this.issue(
      actorId,
      actor.isAdmin,
      {
        user: actor.user,
        scope: "card",
        filter: [chat],
        activeChat: { chatType: "whatsapp", chatId: chat.chatId, ...(channelId ? { channelId } : {}) },
      },
      actor.isAdmin ? [] : [contact],
      [lead],
    );
  }

  private async issue(actorId: number, isAdmin: boolean, payload: WazzupIframeRequest, contacts: WazzupContact[] = [], leads: { id: number; phoneNumber: string | null }[] = []) {
    const revalidate = async () => {
      const currentActor = await this.actor(actorId);
      if (currentActor.isAdmin !== isAdmin) throw new ForbiddenException("Wazzup access changed; reopen the chat window");
      if (!leads.length) return;
      const current = await this.prisma.lead.findMany({
        where: { id: { in: leads.map(lead => lead.id) }, deletedAt: null, ...(isAdmin ? {} : { assignedSalesManagerId: actorId, acceptedAt: { not: null } }) },
        select: { id: true, phoneNumber: true },
      });
      const phones = new Map(current.map(lead => [lead.id, this.phone(lead.phoneNumber)]));
      if (leads.some(lead => !phones.has(lead.id) || phones.get(lead.id) !== this.phone(lead.phoneNumber))) {
        throw new ConflictException({ code: "WAZZUP_ACCESS_CHANGED", message: "Lead access or phone changed; reopen the chat window" });
      }
    };
    const result = await this.client.iframe(payload, contacts, revalidate);
    // A permission/ownership change while the provider issued the link must not
    // release that link to the caller. This does not revoke a provider session.
    await revalidate();
    return result;
  }

  private phone(value: string | null): string | null {
    const phone = value && normalizePhoneNumber(value);
    return phone && /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
  }

  private contact(lead: { id: number; phoneNumber: string | null; displayName: string | null }, responsibleUserId: string): WazzupContact | null {
    const phone = this.phone(lead.phoneNumber);
    if (!phone) return null;
    const chatId = phone.slice(1);
    const name = lead.displayName?.trim().slice(0, 200) || chatId;
    return { id: `lead-${lead.id}`, responsibleUserId, name, contactData: [{ chatType: "whatsapp", chatId }] };
  }

  private async actor(actorId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: {
        id: true,
        firstname: true,
        lastname: true,
        deletedAt: true,
        role: { select: { code: true, deletedAt: true, permissions: { where: { deletedAt: null }, select: { code: true } } } },
      },
    });
    if (!user || user.deletedAt || user.role.deletedAt || !["ADMIN", "SALES_MANAGER"].includes(user.role.code)) throw new ForbiddenException("Wazzup access denied");
    const isAdmin = user.role.code === "ADMIN";
    if (!isAdmin && !user.role.permissions.some(permission => permission.code === LEAD_PERMISSION.MANAGE_OWN)) throw new ForbiddenException("Lead management permission required");
    return { isAdmin, user: { id: String(user.id), name: `${user.firstname} ${user.lastname}`.trim().slice(0, 150) || String(user.id) } };
  }
}
