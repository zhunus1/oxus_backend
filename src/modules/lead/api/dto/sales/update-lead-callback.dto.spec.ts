import { ValidationPipe } from "@nestjs/common";
import { UpdateLeadCallbackDto } from "./update-lead-callback.dto";

describe("callback reason validation", () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidUnknownValues: false });
  const metadata = { type: "body" as const, metatype: UpdateLeadCallbackDto };

  it.each(["NO_ANSWER", "RESCHEDULED", "FOLLOW_UP"])("preserves reason %s through request validation", async reason => {
    await expect(pipe.transform({ reason }, metadata)).resolves.toMatchObject({ reason });
  });

  it.each([null, "", "UNKNOWN", 1, ["FOLLOW_UP"]])("rejects invalid reason %j", async reason => {
    await expect(pipe.transform({ reason }, metadata)).rejects.toMatchObject({ status: 400 });
  });

  it("still accepts existing comment-only updates", async () => {
    await expect(pipe.transform({ comment: "Call tomorrow" }, metadata)).resolves.toMatchObject({ comment: "Call tomorrow" });
  });
});
