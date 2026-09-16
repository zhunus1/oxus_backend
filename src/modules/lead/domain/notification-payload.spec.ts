import { notificationPayload } from "./notification-payload";

describe("notificationPayload", () => {
  it.each([
    ["LEAD_CALLBACK_REMINDER", { leadName: "Әлия" }],
    ["LEAD_CALLBACK_REMINDER", { leadName: null }],
    ["LEAD_EXPERT_CALL_REQUEST", {}],
    ["LEAD_EXPERT_CALL_RESPONSE", { response: "CONFIRMED" }],
    ["LEAD_EXPERT_CALL_RESPONSE", { response: "DECLINED" }],
    ["LEAD_FOLLOW_UP", { leadName: null, leadId: 8, reason: "FOLLOW_UP" }],
  ])("exposes the saved parameters for %s without content", (type, params) => {
    const fields = { id: 5, type, metadata: { callId: 6, params } };
    const notification = { ...fields, content: "Legacy content" };
    expect(notificationPayload(notification)).toEqual({ ...fields, params });
    expect(notification).not.toHaveProperty("params");
    expect(notification.content).toBe("Legacy content");
  });

  it("can localize a legacy request without dynamic parameters", () => {
    expect(notificationPayload({ type: "LEAD_EXPERT_CALL_REQUEST", metadata: { callId: 6 } }).params).toEqual({});
  });

  it.each([null, {}, [], "legacy", { params: null }, { params: [] }, { params: "invalid" }])("omits historical content even when parameters are unavailable: %j", metadata => {
    expect(notificationPayload({ type: "LEAD_CALLBACK_REMINDER", metadata, content: "Пора перезвонить: Әлия" })).toEqual({
      type: "LEAD_CALLBACK_REMINDER",
      metadata,
      params: null,
    });
  });

  it("does not expose unrelated metadata as translation parameters", () => {
    expect(notificationPayload({ type: "FUTURE_TYPE", metadata: { callId: 6 } }).params).toBeNull();
  });
});
