import { parseArgs } from "node:util";
import { isEmail } from "class-validator";
import { getLocalDateParts, incrementCalendarDay, localDateKey, zonedLocalToUtc } from "src/common/helpers/timezone";

export const DEMO_SALES_EMAIL = "sales@oxusedu.com";
export const DEMO_EXPERT_EMAIL = "expert@oxusedu.com";
export const DEMO_TIMEZONE = "Asia/Almaty";
export const DEMO_PREFIX = "sales-expert-demo-v1";

export type DemoKind = "new" | "callback" | "consultation" | "contract" | "rejected";
export interface DemoOptions {
  startDate: string;
  apply: boolean;
  salesEmail: string;
  expertEmail: string;
}
export type DemoInput = Pick<DemoOptions, "apply"> & Partial<Pick<DemoOptions, "salesEmail" | "expertEmail">>;
export interface DemoScenario {
  code: string;
  day: string;
  dayIndex: number;
  position: number;
  name: string;
  kind: DemoKind;
  role: "parent" | "student";
  locale: "ru" | "kk";
  description: string;
}

const names = [
  "Айдана Садыкова",
  "Мадина Омарова",
  "Тимур Ахметов",
  "Аружан Серикова",
  "Данияр Касымов",
  "Сауле Нурланова",
  "Руслан Ибраев",
  "Алина Ким",
  "Нурлан Беков",
  "Елена Смирнова",
  "Арман Тлеубеков",
  "Асем Жумабаева",
  "Ильяс Мусин",
  "Дарья Иванова",
  "Камилла Юсупова",
  "Максим Петров",
  "Амина Ермекова",
  "Санжар Алиев",
  "Диана Попова",
  "Ерасыл Марат",
  "Жанна Исмаилова",
  "Никита Волков",
  "Алия Рахимова",
  "Бекзат Нуров",
  "София Ли",
  "Адиль Сулейменов",
  "Анастасия Орлова",
  "Рамазан Оспанов",
  "Виктория Чен",
  "Мирас Кенжебек",
  "Зарина Сеитова",
  "Александр Соколов",
  "Аяулым Болат",
  "Дамир Каримов",
  "Назерке Аманова",
  "Денис Морозов",
];

const descriptions = [
  "Новая заявка из калькулятора: принять в работу",
  "Родитель: дополнить частичную анкету и записать ребёнка",
  "Ученик: уточнить бюджет и выбрать консультацию",
  "Не отвечает: повторная попытка связи",
  "Клиент попросил перенести консультацию: согласовать новое время",
  "После консультации: обсудить решение с клиентом",
  "Онлайн: эксперт должен подтвердить запрос",
  "Онлайн подтверждён: провести консультацию и сохранить анкету",
  "Офис Алматы: эксперт должен подтвердить запрос",
  "Офис Алматы подтверждён: провести консультацию",
  "Оформление договора после консультации",
  "Окончательный отказ: история и причина в архиве",
];

export function parseDemoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid calendar date; expected YYYY-MM-DD");
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("Invalid start date");
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function demoTime(day: string, minute: number) {
  const parts = parseDemoDate(day);
  return zonedLocalToUtc(parts.year, parts.month, parts.day, minute, DEMO_TIMEZONE);
}

export function demoScenarios(startDate: string): DemoScenario[] {
  let date = parseDemoDate(startDate);
  const result: DemoScenario[] = [];
  for (let dayIndex = 0; dayIndex < 3; dayIndex++) {
    for (let position = 0; position < 12; position++) {
      const number = dayIndex * 12 + position + 1;
      result.push({
        code: `S${String(number).padStart(2, "0")}`,
        day: localDateKey(date),
        dayIndex,
        position,
        name: names[number - 1],
        kind: position < 3 ? "new" : position < 6 ? "callback" : position < 10 ? "consultation" : position === 10 ? "contract" : "rejected",
        role: position % 3 === 1 ? "parent" : "student",
        locale: number % 3 === 0 ? "kk" : "ru",
        description:
          position === 10 ? ["Договор ожидает подписи эксперта", "Договор ожидает подписи клиента", "Договор подписан, ученик закреплён"][dayIndex] : descriptions[position],
      });
    }
    date = incrementCalendarDay(date.year, date.month, date.day);
  }
  return result;
}

export function demoBatchKey(startDate: string, accounts?: { managerId: number; expertId: number }) {
  parseDemoDate(startDate);
  return `${DEMO_PREFIX}:${startDate}${accounts ? `:sales-${accounts.managerId}:expert-${accounts.expertId}` : ""}`;
}

export function normalizeDemoOptions(options: DemoInput, now = new Date()): DemoOptions {
  const normalizeEmail = (value: string | undefined, label: string) => {
    const email = value?.trim().toLowerCase();
    if (!email || email.length > 320 || !isEmail(email)) throw new Error(`Valid ${label} email is required`);
    return email;
  };
  const startDate = localDateKey(getLocalDateParts(now, DEMO_TIMEZONE));
  const salesEmail = normalizeEmail(options.salesEmail ?? DEMO_SALES_EMAIL, "Sales");
  const expertEmail = normalizeEmail(options.expertEmail ?? DEMO_EXPERT_EMAIL, "Expert");
  if (salesEmail === expertEmail) throw new Error("Sales and Expert must be different accounts");
  return { startDate, apply: options.apply, salesEmail, expertEmail };
}

export function parseDemoOptions(args: string[], env: NodeJS.ProcessEnv = process.env, now = new Date()) {
  if (env.STAGING !== "true") throw new Error("Demo seed requires STAGING=true");
  const flags: Record<string, { type: "string" | "boolean" }> = {
    "sales-email": { type: "string" },
    "expert-email": { type: "string" },
    apply: { type: "boolean" },
  };
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args, options: flags, tokens: true, allowPositionals: false, strict: true });
  } catch {
    throw new Error(
      "Usage: [--sales-email=SALES --expert-email=EXPERT] [--apply]. Dates are always today and the following two days in Asia/Almaty; --start-date is not supported.",
    );
  }
  const names = parsed.tokens!.filter(token => token.kind === "option").map(token => token.name);
  if (new Set(names).size !== names.length) throw new Error("Usage: duplicate options are not allowed");
  const value = (name: string) => (typeof parsed.values[name] === "string" ? parsed.values[name] : undefined);
  return normalizeDemoOptions({ apply: parsed.values.apply === true, salesEmail: value("sales-email"), expertEmail: value("expert-email") }, now);
}
