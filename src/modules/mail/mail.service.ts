import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nodemailer from "nodemailer";
import * as path from "path";

@Injectable()
export class MailService implements OnModuleInit {
  private readonly logger = new Logger(MailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const port = Number(this.configService.get<string>("SMTP_PORT", "587"));
    // ConfigService returns strings from .env — parse explicitly to avoid "false" being truthy
    const secure = this.configService.get<string>("SMTP_SECURE", "false") === "true";

    this.transporter = nodemailer.createTransport({
      host: this.configService.get<string>("SMTP_SERVER"),
      port,
      secure,
      auth: {
        user: this.configService.get<string>("SENDER_EMAIL"),
        pass: this.configService.get<string>("SENDER_PASSWORD"),
      },
    });
  }

  async sendMail(to: string, subject: string, text: string, html?: string, attachments?: any[]) {
    try {
      const info = await this.transporter.sendMail({
        from: this.configService.get<string>("SENDER_EMAIL", '"Oxusedu" <noreply@oxusedu.com>'),
        to,
        subject,
        text,
        html,
        attachments,
      });
      this.logger.log(`Message sent: ${info.messageId}`);
      return info;
    } catch (error) {
      this.logger.error(`Error sending email to ${to}: ${error}`);
      throw error;
    }
  }

  async sendConsultationReminder(data: { clientEmail: string; consultantEmail: string; startTime: Date; meetingLink: string; lang?: "ru" | "kk" | "en" }) {
    const { clientEmail, consultantEmail, startTime, meetingLink, lang = "ru" } = data;
    const formattedTime = new Date(startTime).toLocaleString(lang === "kk" ? "kk-KZ" : lang === "ru" ? "ru-RU" : "en-US");

    const translations = {
      ru: {
        subject: "Напоминание: Ваша консультация скоро начнется",
        title: "Напоминание о консультации",
        body: `Ваша консультация запланирована на <strong>${formattedTime}</strong>.`,
        button: "Присоединиться к встрече",
        footer: "С уважением, команда Oxusedu",
      },
      kk: {
        subject: "Ескерту: Сіздің консультацияңыз жақында басталады",
        title: "Консультация туралы ескерту",
        body: `Сіздің консультацияңыз <strong>${formattedTime}</strong> уақытына жоспарланған.`,
        button: "Кездесуге қосылу",
        footer: "Құрметпен, Oxusedu командасы",
      },
      en: {
        subject: "Reminder: Your Consultation is Starting Soon",
        title: "Consultation Reminder",
        body: `Your consultation is scheduled to start at <strong>${formattedTime}</strong>.`,
        button: "Join Meeting",
        footer: "Best regards, Oxusedu Team",
      },
    };

    const t = translations[lang] || translations.en;
    const logoPath = path.join(process.cwd(), "src/assets/logo.png");

    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-bottom: 1px solid #e0e0e0;">
          <img src="cid:logo" alt="Oxusedu Logo" style="max-width: 150px; height: auto;">
        </div>
        <div style="padding: 30px; background-color: #ffffff;">
          <h2 style="color: #333333; margin-top: 0;">${t.title}</h2>
          <p style="color: #555555; font-size: 16px; line-height: 1.5;">${t.body}</p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${meetingLink}" style="display: inline-block; background-color: #007bff; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px; line-height: 1; letter-spacing: 0.3px;">${t.button}</a>
          </div>
          <p style="color: #888888; font-size: 14px; margin-top: 30px; border-top: 1px solid #eeeeee; padding-top: 20px;">
            ${t.footer}
          </p>
        </div>
      </div>
    `;

    const attachments = [
      {
        filename: "logo.png",
        path: logoPath,
        cid: "logo",
      },
    ];

    await Promise.all([this.sendMail(clientEmail, t.subject, t.subject, html, attachments), this.sendMail(consultantEmail, t.subject, t.subject, html, attachments)]);
  }

  async sendMeetingRequestToExpert(data: { expertEmail: string; studentName: string; startTime: Date; dashboardUrl: string; lang?: "ru" | "kk" | "en" }) {
    const { expertEmail, studentName, startTime, dashboardUrl, lang = "ru" } = data;
    const formattedTime = new Date(startTime).toLocaleString(lang === "kk" ? "kk-KZ" : lang === "ru" ? "ru-RU" : "en-US");

    const translations = {
      ru: {
        subject: `Новый запрос на встречу от ${studentName}`,
        title: "Новый запрос на встречу",
        body: `Студент <strong>${studentName}</strong> предлагает встречу на <strong>${formattedTime}</strong>. Перейдите в панель управления, чтобы подтвердить или отклонить.`,
        button: "Перейти в панель управления",
        footer: "С уважением, команда Oxusedu",
      },
      kk: {
        subject: `${studentName} жаңа кездесу сұрауы`,
        title: "Жаңа кездесу сұрауы",
        body: `Студент <strong>${studentName}</strong> <strong>${formattedTime}</strong> уақытына кездесу ұсынады. Растау немесе бас тарту үшін басқару тақтасына өтіңіз.`,
        button: "Басқару тақтасына өту",
        footer: "Құрметпен, Oxusedu командасы",
      },
      en: {
        subject: `New meeting request from ${studentName}`,
        title: "New Meeting Request",
        body: `Student <strong>${studentName}</strong> has suggested a meeting at <strong>${formattedTime}</strong>. Go to your dashboard to confirm or decline.`,
        button: "Go to Dashboard",
        footer: "Best regards, Oxusedu Team",
      },
    };

    const t = translations[lang] || translations.en;
    const logoPath = path.join(process.cwd(), "src/assets/logo.png");

    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-bottom: 1px solid #e0e0e0;">
          <img src="cid:logo" alt="Oxusedu Logo" style="max-width: 150px; height: auto;">
        </div>
        <div style="padding: 30px; background-color: #ffffff;">
          <h2 style="color: #333333; margin-top: 0;">${t.title}</h2>
          <p style="color: #555555; font-size: 16px; line-height: 1.5;">${t.body}</p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${dashboardUrl}" style="display: inline-block; background-color: #007bff; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px; line-height: 1; letter-spacing: 0.3px;">${t.button}</a>
          </div>
          <p style="color: #888888; font-size: 14px; margin-top: 30px; border-top: 1px solid #eeeeee; padding-top: 20px;">
            ${t.footer}
          </p>
        </div>
      </div>
    `;

    await this.sendMail(expertEmail, t.subject, t.subject, html, [{ filename: "logo.png", path: logoPath, cid: "logo" }]);
  }

  async sendCollabInviteEmail(data: {
    to: string;
    inviteeName: string;
    inviterName: string;
    meetingTitle: string;
    startTime: Date;
    dashboardUrl: string;
    jitsiUrl: string;
    lang?: "ru" | "kk" | "en";
  }) {
    const { to, inviterName, meetingTitle, startTime, dashboardUrl, jitsiUrl, lang = "ru" } = data;
    const formattedTime = new Date(startTime).toLocaleString(lang === "kk" ? "kk-KZ" : lang === "ru" ? "ru-RU" : "en-US");

    const translations = {
      ru: {
        subject: `Приглашение на встречу: ${meetingTitle}`,
        title: `Вас приглашают на встречу`,
        body: `<strong>${inviterName}</strong> приглашает вас на встречу <strong>«${meetingTitle}»</strong>, которая состоится <strong>${formattedTime}</strong>.`,
        dashboardBtn: "Открыть в панели управления",
        jitsiBtn: "Присоединиться к видеозвонку",
        footer: "С уважением, команда Oxusedu",
      },
      kk: {
        subject: `Кездесуге шақыру: ${meetingTitle}`,
        title: `Сізді кездесуге шақырады`,
        body: `<strong>${inviterName}</strong> сізді <strong>«${meetingTitle}»</strong> кездесуіне шақырады. Уақыты: <strong>${formattedTime}</strong>.`,
        dashboardBtn: "Басқару тақтасында ашу",
        jitsiBtn: "Бейнебайланысқа қосылу",
        footer: "Құрметпен, Oxusedu командасы",
      },
      en: {
        subject: `Meeting invitation: ${meetingTitle}`,
        title: `You've been invited to a meeting`,
        body: `<strong>${inviterName}</strong> has invited you to <strong>"${meetingTitle}"</strong> on <strong>${formattedTime}</strong>.`,
        dashboardBtn: "Open in Dashboard",
        jitsiBtn: "Join Video Call",
        footer: "Best regards, Oxusedu Team",
      },
    };

    const t = translations[lang] || translations.en;
    const logoPath = path.join(process.cwd(), "src/assets/logo.png");

    const html = `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden;">
        <div style="background-color: #f8f9fa; padding: 20px; text-align: center; border-bottom: 1px solid #e0e0e0;">
          <img src="cid:logo" alt="Oxusedu Logo" style="max-width: 150px; height: auto;">
        </div>
        <div style="padding: 30px; background-color: #ffffff;">
          <h2 style="color: #333333; margin-top: 0;">${t.title}</h2>
          <p style="color: #555555; font-size: 16px; line-height: 1.5;">${t.body}</p>
          <div style="text-align: center; margin: 32px 0; display: flex; flex-direction: column; gap: 12px; align-items: center;">
            <a href="${dashboardUrl}" style="display: inline-block; background-color: #007bff; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px; line-height: 1; letter-spacing: 0.3px;">${t.dashboardBtn}</a>
            <a href="${jitsiUrl}" style="display: inline-block; background-color: #28a745; color: #ffffff; padding: 14px 28px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 15px; line-height: 1; letter-spacing: 0.3px;">${t.jitsiBtn}</a>
          </div>
          <p style="color: #888888; font-size: 14px; margin-top: 30px; border-top: 1px solid #eeeeee; padding-top: 20px;">
            ${t.footer}
          </p>
        </div>
      </div>
    `;

    await this.sendMail(to, t.subject, t.subject, html, [{ filename: "logo.png", path: logoPath, cid: "logo" }]);
  }
}
