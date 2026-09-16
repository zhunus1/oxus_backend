import { ParseUUIDPipe } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { PublicLeadAccessController } from "./public-lead-access.controller";

jest.mock("../service/lead-guest-meeting.service", () => ({ LeadGuestMeetingService: class {} }));
jest.mock("../service/lead-student-invitation.service", () => ({ LeadStudentInvitationService: class {} }));

describe("guest invitation parameter validation", () => {
  const parameters = Reflect.getMetadata(ROUTE_ARGS_METADATA, PublicLeadAccessController, "guest") as Record<string, { pipes: ParseUUIDPipe[] }>;
  const pipe = Object.values(parameters)[0].pipes[0];

  it("returns a stable code for a malformed UUID", async () => {
    await expect(pipe.transform("not-a-uuid", { type: "param" })).rejects.toMatchObject({
      status: 400,
      response: {
        statusCode: 400,
        error: "Bad Request",
        code: "INVALID_INVITATION_ID",
        message: "Validation failed (uuid is expected)",
      },
    });
  });

  it("preserves valid invitation IDs", async () => {
    const id = "1bec4c5e-177d-4d1c-b8dd-4a580507523f";
    await expect(pipe.transform(id, { type: "param" })).resolves.toBe(id);
  });
});
