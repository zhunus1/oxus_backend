import { BadGatewayException, GatewayTimeoutException, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import axios, { AxiosError } from "axios";
import type { AxiosResponse } from "axios";
import { WazzupClient } from "./wazzup.client";
import type { WazzupContact, WazzupIframeRequest } from "./wazzup.client";

describe("WazzupClient", () => {
  const config = new ConfigService({ WAZZUP_ENABLED: "true", WAZZUP_API_KEY: "fixture-api-key" });
  const payload: WazzupIframeRequest = { user: { id: "17", name: "Sales User" }, scope: "card", filter: [{ chatType: "whatsapp", chatId: "77001234567" }] };
  const url = "https://12345678.wazzup24.com/chat/session?token=fixture-session";
  const response = (data: unknown) => ({ data }) as AxiosResponse;
  const client = new WazzupClient(config);
  const activeChannel = { channelId: "channel", transport: "whatsapp", plainId: "77001234567", state: "active" };
  const allowChannel = () => jest.spyOn(client, "channels").mockResolvedValue([activeChannel]);
  let request: jest.SpyInstance;
  let warn: jest.SpyInstance;

  beforeEach(() => {
    request = jest.spyOn(axios, "request").mockResolvedValue(response(null));
    warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([{ WAZZUP_ENABLED: "false", WAZZUP_API_KEY: "fixture" }, { WAZZUP_ENABLED: "true", WAZZUP_API_KEY: "  " }, {}])(
    "makes no requests unless explicitly enabled with a key: %j",
    async values => {
      await expect(new WazzupClient(new ConfigService(values)).channels()).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each(["false", "", "0", "yes"])("never issues a session or synchronizes contacts when disabled (%s), even with a key", async enabled => {
    const disabled = new WazzupClient(new ConfigService({ WAZZUP_ENABLED: enabled, WAZZUP_API_KEY: "fixture-key-present" }));
    await expect(disabled.iframe(payload, [{ id: "lead-8", responsibleUserId: "17", name: "Client", contactData: payload.filter! }])).rejects.toMatchObject({
      response: { code: "WAZZUP_NOT_CONFIGURED" },
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("uses the fixed API origin and returns only public channel fields", async () => {
    const channel = { channelId: "channel", transport: "whatsapp", plainId: "77001234567", state: "active" };
    request.mockResolvedValue(response([{ ...channel, secret: "must-not-leak" }]));
    await expect(client.channels()).resolves.toEqual([channel]);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: "https://api.wazzup24.com/v3/channels",
        headers: { Authorization: "Bearer fixture-api-key", "Content-Type": "application/json" },
        timeout: 10_000,
        maxRedirects: 0,
        maxContentLength: 1024 * 1024,
      }),
    );
  });

  it.each([null, {}, [null], [{ channelId: "channel" }], { error: "FORBIDDEN", secret: "must-not-leak" }].map(data => ({ data })))(
    "rejects malformed channel responses: %j",
    async ({ data }) => {
      request.mockResolvedValue(response(data));
      await expect(client.channels()).rejects.toBeInstanceOf(BadGatewayException);
    },
  );

  it("upserts the user and contacts in batches of at most 100 before issuing a session", async () => {
    allowChannel();
    const contacts: WazzupContact[] = Array.from({ length: 101 }, (_, index) => ({
      id: `lead-${index}`,
      responsibleUserId: "17",
      name: "Client",
      contactData: [{ chatType: "whatsapp", chatId: "77001234567" }],
    }));
    request
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response(null))
      .mockResolvedValueOnce(response({ url, extra: "withheld" }));
    await expect(client.iframe(payload, contacts)).resolves.toEqual({ url });
    expect(request.mock.calls.map(([call]) => [call.url, call.data])).toEqual([
      ["https://api.wazzup24.com/v3/users", [payload.user]],
      ["https://api.wazzup24.com/v3/contacts", contacts.slice(0, 100)],
      ["https://api.wazzup24.com/v3/contacts", contacts.slice(100)],
      ["https://api.wazzup24.com/v3/iframe", payload],
    ]);
  });

  it("does not issue an iframe session after a contact sync failure", async () => {
    allowChannel();
    request.mockResolvedValueOnce(response(null)).mockRejectedValueOnce(new Error("fixture failure"));
    const contact: WazzupContact = { id: "lead-8", responsibleUserId: "17", name: "Client", contactData: payload.filter! };
    await expect(client.iframe(payload, [contact])).rejects.toBeInstanceOf(BadGatewayException);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([
    undefined,
    "not a url",
    "http://123.wazzup24.com/chat",
    "https://wazzup24.com.evil.test/chat",
    "https://evilwazzup24.com/chat",
    "https://user:password@123.wazzup24.com/chat",
    "https://123.wazzup24.com:444/chat",
    "https://123.wazzup24.com/chat",
    "https://123.wazzup24.com/chat?token=",
  ])("rejects invalid or foreign iframe URLs: %s", async invalidUrl => {
    allowChannel();
    request.mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response({ url: invalidUrl }));
    await expect(client.iframe(payload)).rejects.toBeInstanceOf(BadGatewayException);
  });

  it.each([
    [401, "WAZZUP_ACCESS_DENIED", 502],
    [403, "WAZZUP_ACCESS_DENIED", 502],
    [429, "WAZZUP_RATE_LIMITED", 503],
    [500, "WAZZUP_UPSTREAM_ERROR", 502],
  ])("sanitizes upstream HTTP %i failures", async (status, code, expectedStatus) => {
    const error = new AxiosError("fixture-api-key + customer phone + fixture-session", undefined, undefined, undefined, {
      status,
      data: { secret: "must-not-leak" },
    } as AxiosResponse);
    request.mockRejectedValue(error);
    const failure = await client.channels().catch((caught: unknown) => caught);
    expect(failure).toBeInstanceOf(status === 429 ? ServiceUnavailableException : BadGatewayException);
    expect((failure as BadGatewayException).getStatus()).toBe(expectedStatus);
    expect((failure as BadGatewayException).getResponse()).toEqual(expect.objectContaining({ code }));
    expect(JSON.stringify([(failure as BadGatewayException).getResponse(), warn.mock.calls])).not.toMatch(/fixture-api-key|customer phone|fixture-session|must-not-leak/);
  });

  it.each(["ECONNABORTED", "ETIMEDOUT"])("bounds request duration for %s", async code => {
    request.mockRejectedValue(new AxiosError("withheld", code));
    await expect(client.channels()).rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it.each([[], [{ ...activeChannel, state: "disabled" }], [{ ...activeChannel, transport: "telegram" }]].map(channels => ({ channels })))(
    "does no writes when no active WhatsApp channel is available: %j",
    async ({ channels }) => {
      jest.spyOn(client, "channels").mockResolvedValue(channels);
      await expect(client.iframe(payload)).rejects.toMatchObject({ response: { code: "WAZZUP_CHANNEL_UNAVAILABLE" } });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("rejects an absent configured channel even if another channel is active", async () => {
    const configured = new WazzupClient(new ConfigService({ WAZZUP_ENABLED: "true", WAZZUP_API_KEY: "fixture", WAZZUP_CHANNEL_ID: "other" }));
    jest.spyOn(configured, "channels").mockResolvedValue([activeChannel]);
    await expect(configured.iframe(payload)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(request).not.toHaveBeenCalled();
  });

  it("allows WABA and rechecks access both before writes and after synchronization", async () => {
    jest.spyOn(client, "channels").mockResolvedValue([{ ...activeChannel, transport: "wapi" }]);
    const revalidate = jest.fn().mockResolvedValue(undefined);
    request.mockResolvedValueOnce(response(null)).mockResolvedValueOnce(response({ url }));
    await expect(client.iframe(payload, [], revalidate)).resolves.toEqual({ url });
    expect(revalidate).toHaveBeenCalledTimes(2);
  });

  it("does not request a link when access changes during synchronization", async () => {
    allowChannel();
    const failure = new Error("access changed");
    const revalidate = jest.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(failure);
    await expect(client.iframe(payload, [], revalidate)).rejects.toBe(failure);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("uses stable contact IDs for repeated syncs and passes the replacement owner/phone", async () => {
    allowChannel();
    request.mockImplementation(call => Promise.resolve(response(call.url.endsWith("/iframe") ? { url } : null)));
    const contact: WazzupContact = { id: "lead-8", responsibleUserId: "17", name: "Client", contactData: [{ chatType: "whatsapp", chatId: "77001234567" }] };
    await client.iframe(payload, [contact]);
    await client.iframe(payload, [contact]);
    const replacement = { ...contact, responsibleUserId: "18", contactData: [{ chatType: "whatsapp" as const, chatId: "77007654321" }] };
    await client.iframe({ ...payload, user: { id: "18", name: "New owner" }, filter: replacement.contactData }, [replacement]);
    expect(request.mock.calls.filter(([call]) => call.url.endsWith("/contacts")).map(([call]) => call.data)).toEqual([[contact], [contact], [replacement]]);
  });

  it("bounds all sync requests with one cancellation signal and maps budget expiry to 504", async () => {
    allowChannel();
    const controller = new AbortController();
    jest.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    request.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new AxiosError("withheld", "ERR_CANCELED"));
    });
    await expect(client.iframe(payload)).rejects.toBeInstanceOf(GatewayTimeoutException);
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ signal: controller.signal }));
  });
});
