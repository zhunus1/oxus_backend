import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import Twilio from "twilio";

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly twilioClient: Twilio.Twilio | null = null;
  private readonly fromNumber: string;

  constructor(private readonly configService: ConfigService) {
    const accountSid = this.configService.get<string>("TWILIO_ACCOUNT_SID");
    const authToken = this.configService.get<string>("TWILIO_AUTH_TOKEN");
    this.fromNumber = this.configService.get<string>("TWILIO_SMS_FROM", "");

    if (accountSid && authToken) {
      this.twilioClient = Twilio(accountSid, authToken);
    } else {
      this.logger.warn("Twilio credentials not configured — WhatsApp OTP will fall back to console log");
    }
  }

  generate(): string {
    return String(crypto.randomInt(100000, 999999));
  }

  async hash(otp: string): Promise<string> {
    return bcrypt.hash(otp, 10);
  }

  async verify(otp: string, hash: string): Promise<boolean> {
    return bcrypt.compare(otp, hash);
  }

  expiry(minutes = 5): Date {
    return new Date(Date.now() + minutes * 60 * 1000);
  }

  async send(to: { email: string; phone: string; name: string }, otp: string): Promise<void> {
    const toNumber = this.formatE164(to.phone);

    if (!toNumber) {
      this.logger.warn(`[OTP] Invalid phone number for ${to.email}, falling back to console`);
      this.logger.warn(`[DEV] OTP for ${to.email} / ${to.phone}: ${otp}`);
      return;
    }

    try {
      if (!this.twilioClient) {
        throw new Error("Twilio client not initialised");
      }

      await this.twilioClient.messages.create({
        from: this.fromNumber,
        to: toNumber,
        body: `Здравствуйте, ${to.name}! Ваш код для подписания договора: ${otp}. Действителен 5 минут.`,
      });

      this.logger.log(`SMS OTP sent to ${toNumber}`);
    } catch (err) {
      this.logger.error(`Failed to send SMS OTP to ${toNumber}: ${err}`);

      // In non-production, log the OTP so the flow can still be tested locally
      if (process.env.NODE_ENV !== "production") {
        this.logger.warn(`[DEV] OTP for ${to.email} / ${to.phone}: ${otp}`);
        return;
      }

      throw err;
    }
  }

  /** Normalises any phone number to E.164 format (+XXXXXXXXXXX).
   *  Returns null if the number cannot be parsed. */
  private formatE164(phone: string): string | null {
    if (!phone) return null;
    const digits = phone.replace(/[\s\-()]/g, "");
    if (!/^\+?\d{7,15}$/.test(digits)) return null;
    return digits.startsWith("+") ? digits : `+${digits}`;
  }
}
