import { formatLeadCallNotification, scheduleLeadCallNotifications } from "./lead-call-notifications";
import type { Prisma } from "generated/prisma/client";

describe("lead call notifications", () => {
  const call = {
    id: 6,
    leadId: 8,
    expertUserId: 23,
    startTime: new Date("2030-01-02T09:30:00Z"),
    endTime: new Date("2030-01-02T10:00:00Z"),
    updatedAt: new Date("2030-01-01T10:00:00Z"),
  };

  it("persists only assignment and ten-minute email reminders with stable delivery keys", async () => {
    const notificationLog = { updateMany: jest.fn(), createMany: jest.fn() };
    await scheduleLeadCallNotifications({ notificationLog } as unknown as Prisma.TransactionClient, call);
    const { data, skipDuplicates } = notificationLog.createMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data).toHaveLength(2);
    expect(data.map(row => row.channel)).toEqual(["EMAIL", "EMAIL"]);
    expect(data[1].scheduledFor).toEqual(new Date("2030-01-02T09:20:00Z"));
    expect(notificationLog.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ metadata: { path: ["callId"], equals: 6 }, deliveryKey: { notIn: data.map(row => row.deliveryKey) } }),
        data: { status: "CANCELLED", deliveryLeaseUntil: null },
      }),
    );
  });

  it("formats the expert's timezone and keeps user text out of HTML", () => {
    const message = formatLeadCallNotification({ startTime: call.startTime, timezone: "Asia/Almaty", leadName: "<Иван>", leadId: 8, confirmed: false, office: false }, false);
    expect(message.text).toContain("14:30");
    expect(message.text).toContain("02.01.2030");
    expect(message.text).toContain("Asia/Almaty");
    expect(message.text).toContain("<Иван>");
    expect(message.text).toContain("Подтвердите встречу");
  });

  it("uses a lead ID when the name is missing and avoids claiming exactly ten minutes after a delayed retry", () => {
    const message = formatLeadCallNotification({ startTime: call.startTime, timezone: "UTC", leadName: null, leadId: 8, confirmed: true, office: false }, true);
    expect(message.text).toContain("лидом №8");
    expect(message.text).toContain("Скоро начнётся");
    expect(message.text).not.toContain("Подтвердите");
  });
});
