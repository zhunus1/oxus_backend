import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Contract } from "generated/prisma/client";

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  constructor(private readonly configService: ConfigService) {}

  private formatDate(date: Date | string | null | undefined): string {
    if (!date) return "___________";
    return new Date(date).toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" });
  }

  private formatPrice(price: number, currency: string): string {
    return `${price.toLocaleString("ru-RU")} ${currency}`;
  }

  buildHtml(contract: Contract & { student: any; signedByUser?: any }): string {
    const contractDate = this.formatDate(contract.expertSignedAt ?? contract.createdAt);

    const servicePeriod =
      contract.serviceStartDate && contract.serviceEndDate
        ? `с ${this.formatDate(contract.serviceStartDate)} до ${this.formatDate(contract.serviceEndDate)}`
        : `с _____________ до официального подтверждения зачисления`;

    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8"/>
<style>
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12pt; color: #000; margin: 40px 60px; line-height: 1.6; }
  h1 { font-size: 13pt; text-align: center; text-transform: uppercase; margin-bottom: 4px; }
  h2 { font-size: 12pt; text-align: center; margin-bottom: 24px; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 24px; font-size: 11pt; }
  .section-title { font-weight: bold; margin-top: 20px; margin-bottom: 6px; }
  .clause { margin-bottom: 6px; }
  .clause b { display: inline; }
  .signatures { display: flex; gap: 40px; margin-top: 40px; }
  .sig-block { flex: 1; }
  .sig-block h3 { font-size: 11pt; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 4px; margin-bottom: 12px; }
  .sig-line { border-bottom: 1px solid #000; margin: 14px 0; min-height: 20px; }
  .sig-label { font-size: 9pt; color: #555; margin-top: -10px; }
  ul { margin: 4px 0 4px 20px; padding: 0; }
  li { margin-bottom: 3px; }
  .watermark { color: #aaa; font-size: 9pt; text-align: center; margin-top: 30px; }
</style>
</head>
<body>

<h1>ДОГОВОР №${contract.contractNumber}</h1>
<h2>об оказании консалтинговых услуг по зачислению в университет</h2>

<div class="meta">
  <span>г. Шымкент</span>
  <span>«${contractDate}»</span>
</div>

<p>
ТОО "Oxus Global Student Mobility", именуемое в дальнейшем <b>"ИСПОЛНИТЕЛЬ"</b>, в лице директора Дуржанбаев М.Ф., действующего на основании Решения №2, с одной стороны, и
<b>${contract.clientFullName ?? "___________________________"}</b>,
Документ удостоверяющий личность: ИИН <b>${contract.clientIin ?? "_____________"}</b>,
именуемый в дальнейшем <b>"ЗАКАЗЧИК"</b>, с другой стороны, далее совместно именуемые "Стороны",
заключили настоящий Договор о нижеследующем:
</p>

<div class="section-title">1. ПРЕДМЕТ ДОГОВОРА</div>
<div class="clause"><b>1.1.</b> Исполнитель обязуется оказать Заказчику консалтинговые услуги по сопровождению процесса зачисления в зарубежные университеты (далее – "Услуги") для Ученика <b>${contract.studentName ?? "___________________________"}</b> (далее – "Ученик"), а Заказчик обязуется принять и оплатить эти Услуги.</div>
<div class="clause"><b>1.2.</b> Перечень и объём Услуг приведены в Приложении №1, которое является неотъемлемой частью настоящего Договора.</div>
<div class="clause"><b>1.3.</b> Срок оказания Услуг: ${servicePeriod} (до официального подтверждения зачисления).</div>
<div class="clause"><b>1.4.</b> Оказание Услуг Исполнителем включает Гарантированное зачисление, если Учеником выбран хотя бы один университет из рекомендованного списка Исполнителем.</div>

<div class="section-title">2. СТОИМОСТЬ УСЛУГ И ПОРЯДОК ОПЛАТЫ</div>
<div class="clause"><b>2.1.</b> Стоимость Услуг составляет <b>${this.formatPrice(contract.price, contract.currency)}</b>.</div>
<div class="clause"><b>2.2.</b> Оплата производится Заказчиком путём банковского перевода, наличными и т.д., в следующем порядке: При подписании настоящего Договора Заказчик производит оплату в 100% размере.</div>
<div class="clause"><b>2.3.</b> Моментом оплаты считается дата поступления денежных средств на расчётный счёт Исполнителя.</div>

<div class="section-title">3. ПРАВА И ОБЯЗАННОСТИ СТОРОН</div>
<div class="clause"><b>3.1.</b> Исполнитель обязуется оказать следующие Услуги:</div>
<ul>
  <li>Полная подготовка и координация заявки для гарантированного зачисления; поддержка до 3 заявок.</li>
  <li>Просмотр профиля и рекомендации по сфере обучения; выбор университета и шорт-лист (3 варианта).</li>
  <li>Редактирование резюме (международный формат) и мотивационного письма с обратной связью.</li>
  <li>Контрольный список документов, проверка документов перед подачей, поддержка при подаче заявки.</li>
  <li>Координация с университетами, официальное подтверждение зачисления и визовое приглашение.</li>
  <li>Полная поддержка по визовым, жилищным и финансовым вопросам (стипендии, страховка, прибытие).</li>
  <li>Персональная консультационная поддержка через WhatsApp и Zoom; приоритетный ответ.</li>
  <li>Встреча в аэропорту и консультация после прибытия.</li>
</ul>
<div class="clause"><b>3.2.</b> Заказчик обязуется своевременно оплатить Услуги, предоставлять документы и достоверную информацию, а также выбрать хотя бы один университет из рекомендованного списка.</div>

<div class="section-title">4. ОТВЕТСТВЕННОСТЬ СТОРОН И ГАРАНТИИ</div>
<div class="clause"><b>4.1.</b> Исполнитель гарантирует зачисление при соблюдении всех условий Договора.</div>
<div class="clause"><b>4.2.</b> Исполнитель не несёт ответственности за отказ в зачислении, если Ученик не выбрал ни одного рекомендованного университета.</div>
<div class="clause"><b>4.3.</b> В случае незачисления при надлежащем выполнении обязательств, Исполнитель продолжает оказывать Услуги до официального подтверждения зачисления.</div>
<div class="clause"><b>4.4.</b> При одностороннем расторжении по инициативе Заказчика возврат оплаченных средств не осуществляется.</div>

<div class="section-title">5. СРОК ДЕЙСТВИЯ И РАСТОРЖЕНИЕ</div>
<div class="clause"><b>5.1.</b> Договор вступает в силу с момента подписания и действует до официального подтверждения зачисления.</div>
<div class="clause"><b>5.2.</b> Все споры разрешаются путём переговоров, при невозможности — в соответствии с законодательством Республики Казахстан.</div>

<div class="signatures">
  <div class="sig-block">
    <h3>ИСПОЛНИТЕЛЬ</h3>
    <p>ТОО "OXUS GLOBAL STUDENT MOBILITY"<br/>
    Адрес: г. Шымкент, Микрорайон Нурсат, 259<br/>
    БИН: 180340009118<br/>
    Банк: АО «Kaspi Bank»<br/>
    ИИК: KZ68722S000051661691 KZT<br/>
    КБе 17, БИК CASPKZKA</p>
    <p>Директор</p>
    <div class="sig-line"></div>
    <div class="sig-label">Дуржанбаев М.Ф. ${contract.expertSignedAt ? `/ Подписано ${this.formatDate(contract.expertSignedAt)}` : ""}</div>
  </div>

  <div class="sig-block">
    <h3>ЗАКАЗЧИК</h3>
    <p>ФИО: <b>${contract.clientFullName ?? "___________________________"}</b><br/>
    ФИО ученика: <b>${contract.studentName ?? "___________________________"}</b><br/>
    Адрес: ${contract.clientAddress ?? "___________________________"}<br/>
    ИИН: <b>${contract.clientIin ?? "_____________"}</b><br/>
    Тел: ${contract.clientPhone ?? "_______________"}</p>
    <p>Подпись</p>
    <div class="sig-line"></div>
    <div class="sig-label">${contract.studentSignedAt ? `Подписано ${this.formatDate(contract.studentSignedAt)}` : ""}</div>
  </div>
</div>

<div class="watermark">Документ сформирован системой AcademicApply · ${contract.contractNumber}</div>
</body>
</html>`;
  }

  async generatePdf(contract: Contract & { student: any; signedByUser?: any }): Promise<Buffer> {
    // Connects to a remote Chrome instance (CHROME_WS_URL=ws://chrome:9222).
    // Falls back to local launch when the env var is not set (e.g. local dev).
    const puppeteer = await import("puppeteer");
    const wsUrl = this.configService.get<string>("CHROME_WS_URL");

    let browser: any;
    try {
      if (wsUrl) {
        browser = await puppeteer.default.connect({ browserWSEndpoint: wsUrl, defaultViewport: null });
      } else {
        browser = await puppeteer.default.launch({
          headless: true,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
      }

      const page = await browser.newPage();
      const html = this.buildHtml(contract);
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdfBuffer = await page.pdf({ format: "A4", margin: { top: "20mm", bottom: "20mm", left: "20mm", right: "20mm" }, printBackground: true });
      return Buffer.from(pdfBuffer);
    } catch (err) {
      this.logger.error("PDF generation failed", err);
      throw err;
    } finally {
      if (browser) {
        if (wsUrl) {
          await browser.disconnect();
        } else {
          await browser.close();
        }
      }
    }
  }
}
