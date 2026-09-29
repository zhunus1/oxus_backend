import axios from "axios";
import { createHash } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { FreedomPayService } from "./freedompay.service";

describe("FreedomPay documented init contract", () => {
  afterEach(() => jest.restoreAllMocks());
  it.each(["0", "1"])("signs pg_request_method=POST in mode %s", async mode => {
    const post = jest.spyOn(axios, "post").mockResolvedValue({ data: "<response><pg_status>ok</pg_status></response>" });
    const service = new FreedomPayService(
      new ConfigService({
        FREEDOM_API_URL: "https://example.invalid",
        FREEDOM_MERCHANT_ID: "fixture",
        FREEDOM_RECEIVE_SECRET_KEY: "synthetic",
        FREEDOM_RESULT_URL: "https://example.invalid/api/v1/payment/freedompay-webhook",
        FREEDOM_SUCCESS_URL: "https://example.invalid/ok",
        FREEDOM_FAILURE_URL: "https://example.invalid/fail",
        FREEDOM_TESTING_MODE: mode,
      }),
    );
    await service.initPayment("fixture-order", 1500000, "KZT");
    const payload = Object.fromEntries((post.mock.calls[0][1] as FormData).entries());
    expect(payload.pg_request_method).toBe("POST");
    expect(payload).not.toHaveProperty("Pg_result_url_method");
    expect(payload.pg_testing_mode).toBe(mode);
    const { pg_sig, ...fields } = payload;
    const expected = createHash("md5")
      .update(
        [
          "init_payment.php",
          ...Object.keys(fields)
            .sort()
            .map(key => {
              const value = fields[key];
              if (typeof value !== "string") throw new Error("Init payload must contain scalar strings");
              return value;
            }),
          "synthetic",
        ].join(";"),
      )
      .digest("hex");
    expect(pg_sig).toBe(expected);
  });
});
