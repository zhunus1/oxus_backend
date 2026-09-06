import { Body, Controller, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Throttle, ThrottlerGuard } from "@nestjs/throttler";
import { Public } from "src/modules/admin/auth/rbac/public.decorator";
import { AcceptStudentInvitationDto } from "./dto/sales/sales-v2.dto";
import { LeadGuestMeetingService } from "../service/lead-guest-meeting.service";
import { LeadStudentInvitationService } from "../service/lead-student-invitation.service";
/** Provides rate-limited guest meeting access and student account activation without a login. */
@ApiTags("Lead Guest Access")
@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ "public-lead-submission": { limit: 15, ttl: 60_000 } })
@Controller("public/leads")
export class PublicLeadAccessController {
  constructor(
    private readonly meetings: LeadGuestMeetingService,
    private readonly invitations: LeadStudentInvitationService,
  ) {}
  /** Exchanges an opaque meeting invitation for access after checking meeting state and time. */
  @Post("meetings/:invitationId/access")
  guest(@Param("invitationId", ParseUUIDPipe) id: string) {
    return this.meetings.guestAccess(id);
  }
  /** Consumes a valid one-use activation token to set the student password. */
  @Post("student-invitations/accept")
  activate(@Body() dto: AcceptStudentInvitationDto) {
    return this.invitations.accept(dto);
  }
}
