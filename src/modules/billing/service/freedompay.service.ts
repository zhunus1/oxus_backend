import axios from "axios";
import crypto from "crypto";
import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, Logger, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { XMLParser } from "fast-xml-parser";
import { PaymentIntentDto } from "../api/dtos/freedom-pay.dto";
import { freedomSignature, VerifiedFreedomPayment } from "../domain/freedom-signature";

@Injectable()
export class FreedomPayService {
  private readonly FREEDOM_API_URL: string;
  private readonly FREEDOM_MERCHANT_ID: string;
  private readonly FREEDOM_RECEIVE_SECRET_KEY: string;
  private readonly FREEDOM_RESULT_URL: string;
  private readonly FREEDOM_SUCCESS_URL: string;
  private readonly FREEDOM_FAILURE_URL: string;

  private readonly logger = new Logger(FreedomPayService.name);

  constructor(private readonly configService: ConfigService) {
    this.FREEDOM_API_URL = this.configService.get<string>("FREEDOM_API_URL")!;
    this.FREEDOM_MERCHANT_ID = this.configService.get<string>("FREEDOM_MERCHANT_ID")!;
    this.FREEDOM_RECEIVE_SECRET_KEY = this.configService.get<string>("FREEDOM_RECEIVE_SECRET_KEY")!;
    this.FREEDOM_RESULT_URL = this.configService.get<string>("FREEDOM_RESULT_URL")!;
    this.FREEDOM_SUCCESS_URL = this.configService.get<string>("FREEDOM_SUCCESS_URL")!;
    this.FREEDOM_FAILURE_URL = this.configService.get<string>("FREEDOM_FAILURE_URL")!;
  }

  async initPayment(orderId: string, amount: number, currency: string): Promise<PaymentIntentDto> {
    try {
      const scriptName = "init_payment.php";

      const messageFields = {
        pg_amount: amount,
        pg_currency: currency,
        pg_description: "Academy Subscription",
        pg_merchant_id: this.FREEDOM_MERCHANT_ID,
        pg_language: "ru",
        pg_order_id: orderId,
        pg_salt: this.generateSalt(),
        pg_testing_mode: this.testingMode(),
        pg_auto_clearing: 1,
        show_email: 0,
        pg_payment_route: "frame",
        pg_result_url: this.FREEDOM_RESULT_URL,
        pg_request_method: "POST",
        pg_success_url: this.FREEDOM_SUCCESS_URL,
        pg_failure_url: this.FREEDOM_FAILURE_URL,
      };
      const signature = this.generateSignature(scriptName, messageFields, this.FREEDOM_RECEIVE_SECRET_KEY);

      messageFields["pg_sig"] = signature;

      const formData = new FormData();
      for (const key in messageFields) {
        formData.append(key, messageFields[key]);
      }

      const response = await axios.post(`${this.FREEDOM_API_URL}/${scriptName}`, formData);

      const parser = new XMLParser();
      const paymentIntentObject = parser.parse(response.data as string);
      const paymentIntent: PaymentIntentDto = paymentIntentObject.response;

      return paymentIntent;
    } catch (error) {
      this.logger.error(error, error.stack);
      throw new InternalServerErrorException("Payment gateway error. Try again");
    }
  }

  async handleWebhook(data: Record<string, unknown>): Promise<VerifiedFreedomPayment> {
    const script = this.resultScript();
    const signature = data?.pg_sig;
    if (typeof signature !== "string" || !/^[a-f0-9]{32}$/.test(signature)) throw new ForbiddenException("Invalid payment signature");
    // Incoming receipts use the same receiving merchant secret as init_payment.php, not the payout secret.
    const expected = freedomSignature(script, data, this.FREEDOM_RECEIVE_SECRET_KEY);
    if (!crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"))) throw new ForbiddenException("Invalid payment signature");
    // The signature validator has rejected objects/arrays; fields remain uncoerced until this point.
    const fields = data as Record<string, string | number | undefined>;
    if (String(fields.pg_result) !== "1" || fields.pg_failure_code || fields.pg_failure_description || fields.pg_error_code)
      throw new BadRequestException("Payment is not successful");
    const methods = ["bankcard", "wallet", "internetbank", "other", "cash", "mobile_commerce"];
    if (
      !methods.includes(String(fields.pg_payment_method)) ||
      (fields.pg_payment_method === "bankcard" && String(fields.pg_captured) !== "1") ||
      (fields.pg_captured !== undefined && String(fields.pg_captured) !== "1")
    )
      throw new BadRequestException("Payment is not captured");
    if (String(fields.pg_testing_mode) !== String(this.testingMode()) || (fields.pg_merchant_id !== undefined && String(fields.pg_merchant_id) !== this.FREEDOM_MERCHANT_ID))
      throw new ForbiddenException("Payment context mismatch");
    if (
      typeof fields.pg_order_id !== "string" ||
      !fields.pg_order_id ||
      !/^\d+$/.test(String(fields.pg_payment_id)) ||
      !/^\d+(?:\.\d{1,2})?$/.test(String(fields.pg_amount)) ||
      !/^[A-Z]{3}$/.test(String(fields.pg_currency)) ||
      typeof fields.pg_salt !== "string" ||
      !fields.pg_salt
    )
      throw new BadRequestException("Invalid payment fields");
    return {
      orderId: fields.pg_order_id,
      paymentId: String(fields.pg_payment_id),
      amount: String(fields.pg_amount),
      currency: String(fields.pg_currency),
      merchantId: this.FREEDOM_MERCHANT_ID,
    };
  }

  webhookAcknowledgement(): string {
    const fields = { pg_status: "ok", pg_description: "Payment accepted", pg_salt: crypto.randomBytes(16).toString("hex") };
    const signature = freedomSignature(this.resultScript(), fields, this.FREEDOM_RECEIVE_SECRET_KEY);
    return `<?xml version="1.0" encoding="utf-8"?><response><pg_status>ok</pg_status><pg_description>Payment accepted</pg_description><pg_salt>${fields.pg_salt}</pg_salt><pg_sig>${signature}</pg_sig></response>`;
  }

  private resultScript() {
    if (!this.FREEDOM_RECEIVE_SECRET_KEY || !this.FREEDOM_MERCHANT_ID || !this.FREEDOM_RESULT_URL) throw new ServiceUnavailableException("Payment verification is not configured");
    try {
      const script = new URL(this.FREEDOM_RESULT_URL).pathname.split("/").at(-1);
      if (!script) throw new Error();
      return script;
    } catch {
      throw new ServiceUnavailableException("Payment result URL is invalid");
    }
  }

  private testingMode(): number {
    const mode = String(this.configService.get<string>("FREEDOM_TESTING_MODE") ?? "0");
    if (mode !== "0" && mode !== "1") throw new ServiceUnavailableException("Payment testing mode is invalid");
    return Number(mode);
  }

  private generateSignature(scriptName: string, messageFields: Record<string, any>, paymentSecretKey: string) {
    return freedomSignature(scriptName, messageFields, paymentSecretKey);
  }

  private generateSalt(): string {
    return Math.random().toString(36).slice(2);
  }
}
