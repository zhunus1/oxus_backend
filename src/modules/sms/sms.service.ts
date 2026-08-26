import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Twilio from "twilio";

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly client: Twilio.Twilio | null = null;
  private readonly channel: "sms" | "whatsapp";
  private readonly smsFrom: string;
  private readonly whatsappFrom: string;
  private readonly contentSid: string;

  constructor(private readonly config: ConfigService) {
    const accountSid = config.get<string>("TWILIO_ACCOUNT_SID");
    const authToken = config.get<string>("TWILIO_AUTH_TOKEN");
    // Notification channel for meeting requests. Defaults to "sms" — it works
    // instantly to any number with no recipient opt-in. Switch to "whatsapp" by
    // setting MEETING_NOTIFY_CHANNEL=whatsapp once a WhatsApp Business sender is
    // approved (no code change/redeploy needed).
    this.channel = config.get<string>("MEETING_NOTIFY_CHANNEL", "sms") === "whatsapp" ? "whatsapp" : "sms";
    this.smsFrom = config.get<string>("TWILIO_SMS_FROM", "");
    this.whatsappFrom = config.get<string>("TWILIO_WHATSAPP_FROM", "whatsapp:+14155238886");
    // Optional. When set (WhatsApp channel only), business-initiated messages are
    // sent via an approved WhatsApp template (Content API) — required for a real
    // WhatsApp Business sender. When empty, falls back to free-form text which
    // only works on the sandbox or within a 24h reply window.
    this.contentSid = config.get<string>("TWILIO_WHATSAPP_CONTENT_SID", "");

    if (accountSid && authToken) {
      this.client = Twilio(accountSid, authToken);
    } else {
      this.logger.warn("Twilio not configured — meeting notifications disabled");
    }
  }

  async sendMeetingRequest(expert: { phone: string; name: string }, student: { name: string }, startTime: Date): Promise<void> {
    const e164 = this.formatE164(expert.phone);
    if (!e164) {
      this.logger.warn(`[SMS] Expert "${expert.name}" has no valid phone number — skipping notification`);
      return;
    }

    const formatted = startTime.toLocaleString("en-GB", {
      timeZone: "Asia/Almaty",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    const body = `Hi ${expert.name}! ` + `${student.name} has requested a meeting on ${formatted}. ` + `Please confirm or decline: https://expert.academicapply.com/meetings`;

    try {
      if (!this.client) throw new Error("Twilio client not initialised");

      if (this.channel === "whatsapp") {
        await this.client.messages.create(
          this.contentSid
            ? {
                from: this.whatsappFrom,
                to: `whatsapp:${e164}`,
                contentSid: this.contentSid,
                // Template variables {{1}}, {{2}}, {{3}} — must match the approved template
                contentVariables: JSON.stringify({ "1": expert.name, "2": student.name, "3": formatted }),
              }
            : { from: this.whatsappFrom, to: `whatsapp:${e164}`, body },
        );
      } else {
        if (!this.smsFrom) throw new Error("TWILIO_SMS_FROM not configured");
        await this.client.messages.create({ from: this.smsFrom, to: e164, body });
      }

      this.logger.log(`Meeting notification (${this.channel}) sent to ${e164}`);
    } catch (err) {
      // Non-fatal — email notification already sent via queue
      this.logger.error(`Failed to send meeting notification (${this.channel}) to ${e164}: ${err}`);
    }
  }

  private formatE164(phone: string): string | null {
    if (!phone) return null;
    const hasPlus = phone.trim().startsWith("+");
    let digits = phone.replace(/[\s\-()+]/g, "");
    // Kazakhstan/Russia local format: trunk prefix 8 maps to country code +7.
    // Only applied when the number wasn't already given in international (+) form.
    if (!hasPlus && digits.length === 11 && digits.startsWith("8")) {
      digits = `7${digits.slice(1)}`;
    }
    if (!/^\d{7,15}$/.test(digits)) return null;
    return `+${digits}`;
  }
}
