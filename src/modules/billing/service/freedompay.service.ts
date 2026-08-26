import axios from "axios";
import crypto from "crypto";
import { Injectable, InternalServerErrorException, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { XMLParser } from "fast-xml-parser";
import { FreedomPaymentDto, PaymentIntentDto } from "../api/dtos/freedom-pay.dto";

@Injectable()
export class FreedomPayService {
  private readonly FREEDOM_API_URL: string;
  private readonly FREEDOM_MERCHANT_ID: string;
  private readonly FREEDOM_RECEIVE_SECRET_KEY: string;
  private readonly FREEDOM_PAYMENT_SECRET_KEY: string;
  private readonly FREEDOM_RESULT_URL: string;
  private readonly FREEDOM_SUCCESS_URL: string;
  private readonly FREEDOM_FAILURE_URL: string;

  private readonly logger = new Logger(FreedomPayService.name);

  constructor(private readonly configService: ConfigService) {
    this.FREEDOM_API_URL = this.configService.get<string>("FREEDOM_API_URL")!;
    this.FREEDOM_MERCHANT_ID = this.configService.get<string>("FREEDOM_MERCHANT_ID")!;
    this.FREEDOM_RECEIVE_SECRET_KEY = this.configService.get<string>("FREEDOM_RECEIVE_SECRET_KEY")!;
    this.FREEDOM_PAYMENT_SECRET_KEY = this.configService.get<string>("FREEDOM_PAYMENT_SECRET_KEY")!;
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
        pg_testing_mode: 1,
        pg_auto_clearing: 1,
        show_email: 0,
        pg_payment_route: "frame",
        pg_result_url: this.FREEDOM_RESULT_URL,
        Pg_result_url_method: "POST",
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

  async handleWebhook(data: FreedomPaymentDto): Promise<FreedomPaymentDto> {
    const signature = data.pg_sig;

    const verifiedSignature = this.generateSignature("freedompay-webhook", data, this.FREEDOM_PAYMENT_SECRET_KEY);

    if (verifiedSignature != signature) {
      this.logger.error(`BAD SIGNATURE. Correct: ${verifiedSignature}, received: ${signature}`);
    }
    return data;
  }

  private generateSignature(scriptName: string, messageFields: Record<string, any>, paymentSecretKey: string) {
    const messages = Object.keys(messageFields)
      .sort()
      .map(key => messageFields[key]);

    const components: string[] = [scriptName, ...messages, paymentSecretKey];
    const toHash = components.join(";");

    const signature = crypto.createHash("md5").update(toHash).digest("hex");

    return signature;
  }

  private generateSalt(): string {
    return Math.random().toString(36).slice(2);
  }
}
