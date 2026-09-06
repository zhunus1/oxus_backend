import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "src/database/prisma.service";
import { JitsiService } from "src/modules/meeting/service/jitsi.service";

/** Issues room-scoped guest or moderator tokens only during confirmed consultation access windows. */
@Injectable()
export class LeadGuestMeetingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jitsi: JitsiService,
  ) {}

  /** Exchanges an opaque invitation for a short-lived guest token without returning lead personal data. */
  async guestAccess(invitationId: string) {
    const invitation = await this.prisma.leadMeetingInvitation.findUnique({
      where: { id: invitationId },
      include: { call: { include: { meeting: true, lead: { select: { deletedAt: true } } } } },
    });
    const call = invitation?.call;
    if (!invitation || invitation.cancelledAt || !call || call.format !== "ONLINE" || call.lead.deletedAt) throw new NotFoundException("Meeting is not available");
    this.assertAccess(call);
    // The opaque invitation is a capability. Do not expose the lead's contacts or questionnaire.
    return this.jitsi.signLeadRoomToken(
      invitation.roomName,
      { id: `guest-${invitation.id}`, name: "Гость" },
      false,
      new Date(Math.min(call.endTime.getTime(), Date.now() + 5 * 60_000)),
    );
  }

  /** Issues a moderator token only to the currently assigned expert for an active online meeting. */
  async expertAccess(expertId: number, callId: number) {
    const call = await this.prisma.leadExpertCall.findFirst({
      where: { id: callId, expertUserId: expertId, lead: { assignedExpertUserId: expertId, deletedAt: null } },
      include: { meeting: true, expertUser: { select: { firstname: true, lastname: true } } },
    });
    if (!call || call.format !== "ONLINE") throw new NotFoundException("Meeting is not available");
    this.assertAccess(call);
    return this.jitsi.signLeadRoomToken(
      call.meeting!.roomName,
      { id: String(expertId), name: `${call.expertUser.firstname} ${call.expertUser.lastname}` },
      true,
      new Date(Math.min(call.endTime.getTime(), Date.now() + 5 * 60_000)),
    );
  }

  /** Requires an active confirmed meeting between ten minutes before its start and its end. */
  private assertAccess(call: { status: string; startTime: Date; endTime: Date; meeting: { status: string } | null }) {
    if (call.status !== "CONFIRMED" || call.meeting?.status !== "SCHEDULED") throw new ForbiddenException("Meeting is not confirmed or is no longer active");
    if (Date.now() < call.startTime.getTime() - 10 * 60_000 || Date.now() >= call.endTime.getTime())
      throw new ForbiddenException("Meeting access is available from 10 minutes before start until its end");
  }
}
