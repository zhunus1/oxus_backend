import type { PrismaService } from "src/database/prisma.service";
import type { JitsiService } from "src/modules/meeting/service/jitsi.service";
import { LeadGuestMeetingService } from "./lead-guest-meeting.service";

jest.mock("src/database/prisma.service", () => ({ PrismaService: class {} }));
jest.mock("src/modules/meeting/service/jitsi.service", () => ({ JitsiService: class {} }));

describe("LeadGuestMeetingService access boundaries", () => {
  const startTime = new Date("2026-10-01T04:00:00Z");
  const endTime = new Date("2026-10-01T04:30:00Z");
  const findUnique = jest.fn();
  const findFirst = jest.fn();
  const signLeadRoomToken = jest.fn();
  const service = new LeadGuestMeetingService(
    { leadMeetingInvitation: { findUnique }, leadExpertCall: { findFirst } } as unknown as PrismaService,
    { signLeadRoomToken } as unknown as JitsiService,
  );
  const activeCall = () => ({ format: "ONLINE", status: "CONFIRMED", startTime, endTime, lead: { deletedAt: null }, meeting: { status: "SCHEDULED", roomName: "room-1" } });

  beforeEach(() => {
    jest.resetAllMocks();
    jest.useFakeTimers().setSystemTime(startTime);
    findUnique.mockResolvedValue({ id: "opaque-id", roomName: "room-1", call: activeCall() });
    signLeadRoomToken.mockReturnValue({ token: "room-token" });
  });
  afterEach(() => jest.useRealTimers());

  it.each([-600_001, 1_800_000, 1_800_001])("denies guest access outside the window at offset %i ms", async offset => {
    jest.setSystemTime(startTime.getTime() + offset);
    await expect(service.guestAccess("opaque-id")).rejects.toThrow("Meeting access is available");
    expect(signLeadRoomToken).not.toHaveBeenCalled();
  });

  it.each([-600_000, 0, 1_740_000])("issues a guest-only token with bounded expiry at offset %i ms", async offset => {
    jest.setSystemTime(startTime.getTime() + offset);
    await expect(service.guestAccess("opaque-id")).resolves.toEqual({ token: "room-token" });
    expect(signLeadRoomToken).toHaveBeenCalledWith("room-1", { id: "guest-opaque-id", name: "Гость" }, false, new Date(Math.min(Date.now() + 300_000, endTime.getTime())));
  });

  it.each(["REQUESTED", "DECLINED", "CANCELLED", "COMPLETED"])("denies guest access for a %s call", async status => {
    findUnique.mockResolvedValue({ id: "opaque-id", call: { ...activeCall(), status } });
    await expect(service.guestAccess("opaque-id")).rejects.toThrow("Meeting is not confirmed");
    expect(signLeadRoomToken).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { call: null },
    { cancelledAt: new Date(), call: activeCall() },
    { call: { ...activeCall(), format: "OFFICE" } },
    { call: { ...activeCall(), lead: { deletedAt: new Date() } } },
  ])("hides unavailable guest invitations", async invitation => {
    findUnique.mockResolvedValue(invitation);
    await expect(service.guestAccess("opaque-id")).rejects.toThrow("Meeting is not available");
    expect(signLeadRoomToken).not.toHaveBeenCalled();
  });

  it("issues moderator access only after querying current expert ownership", async () => {
    findFirst.mockResolvedValue({ ...activeCall(), expertUser: { firstname: "Expert", lastname: "Name" } });
    await service.expertAccess(23, 6);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 6, expertUserId: 23, lead: { assignedExpertUserId: 23, deletedAt: null } } }));
    expect(signLeadRoomToken).toHaveBeenCalledWith("room-1", { id: "23", name: "Expert Name" }, true, new Date(startTime.getTime() + 300_000));
    findFirst.mockResolvedValue(null);
    await expect(service.expertAccess(24, 6)).rejects.toThrow("Meeting is not available");
    expect(signLeadRoomToken).toHaveBeenCalledTimes(1);
  });
});
