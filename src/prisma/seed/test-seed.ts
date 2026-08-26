import { QuestionType } from "generated/prisma/enums";
import { prismaClient } from "./prisma-client";

const test = {
  id: 1,
  title: "My Global Study Roadmap",
  description:
    "Nervous about university applications? Let our AI find the perfect fit for your budget and interests. In just 2 minutes, we’ll build a seamless path from your current level to your dream campus.",
};

const questionsData = [
  {
    order: 1,
    text: "Full name",
    type: QuestionType.TEXT,
    options: [],
  },
  {
    order: 2,
    text: "Phone number",
    type: QuestionType.PHONE,
    options: [],
  },
  {
    order: 3,
    text: "Email",
    type: QuestionType.EMAIL,
    options: [],
  },
  {
    order: 4,
    text: "What is your desired level of education?",
    type: QuestionType.SINGLE_CHOICE,
    options: ["Bachelor’s Degree", "Master’s Degree", "PhD / Doctorate", "High School"],
  },
  {
    order: 5,
    text: "Which countries are you considering for your studies?",
    type: QuestionType.TEXT,
    options: [],
  },
  {
    order: 6,
    text: "What is your maximum annual budget for tuition (USD)?",
    type: QuestionType.NUMERIC,
    options: [],
  },
  {
    order: 7,
    text: "What is your primary field of interest?",
    type: QuestionType.TEXT,
    options: [],
  },
  {
    order: 8,
    text: "What is your current GPA?",
    type: QuestionType.NUMERIC,
    options: [],
  },
  {
    order: 9,
    text: "What is your latest IELTS/TOEFL score?",
    type: QuestionType.NUMERIC,
    options: [],
  },
  {
    order: 10,
    text: "Tell me about your studies—are there any specific subjects you’ve focused on or competitions you’ve taken part in?",
    type: QuestionType.TEXT,
    options: [],
  },
];

const testRu = {
  id: 2,
  title: "Мой план обучения за рубежом",
  description:
    "Волнуетесь из-за поступления в университет? Наш ИИ подберёт идеальный вариант под ваш бюджет и интересы. Всего за 2 минуты мы построим путь от вашего текущего уровня до университета вашей мечты.",
};

const questionsDataRu = [
  {
    order: 1,
    text: "ФИО",
    type: QuestionType.TEXT,
    options: [],
  },
  {
    order: 2,
    text: "Номер телефона",
    type: QuestionType.PHONE,
    options: [],
  },
  {
    order: 3,
    text: "Почта",
    type: QuestionType.EMAIL,
    options: [],
  },
  {
    order: 4,
    text: "Какой уровень образования вы хотите получить?",
    type: QuestionType.SINGLE_CHOICE,
    options: ["Бакалавриат", "Магистратура", "PhD / Докторантура", "Среднее образование"],
  },
  {
    order: 5,
    text: "Какие страны вы рассматриваете для обучения?",
    type: QuestionType.TEXT,
    options: [],
  },
  {
    order: 6,
    text: "Какой ваш максимальный годовой бюджет на обучение (USD)?",
    type: QuestionType.NUMERIC,
    options: [],
  },
  {
    order: 7,
    text: "Какая ваша основная область интересов?",
    type: QuestionType.TEXT,
    options: [],
  },
  {
    order: 8,
    text: "Какой у вас текущий средний балл (GPA)?",
    type: QuestionType.NUMERIC,
    options: [],
  },
  {
    order: 9,
    text: "Какой у вас последний балл IELTS/TOEFL?",
    type: QuestionType.NUMERIC,
    options: [],
  },
  {
    order: 10,
    text: "Расскажите о вашей учёбе — есть ли предметы, на которых вы специализировались, или олимпиады, в которых участвовали?",
    type: QuestionType.TEXT,
    options: [],
  },
];

async function seedTest(testData: { id: number; title: string; description: string }, questions: typeof questionsData) {
  await prismaClient.test.upsert({
    where: { id: testData.id },
    create: testData,
    update: testData,
  });

  for (const question of questions) {
    const savedQuestion = await prismaClient.question.upsert({
      where: { testId_order: { testId: testData.id, order: question.order } },
      create: {
        testId: testData.id,
        order: question.order,
        text: question.text,
        type: question.type,
        required: true,
      },
      update: {
        text: question.text,
        type: question.type,
        required: true,
      },
    });

    if (question.options.length > 0) {
      for (const [index, opt] of question.options.entries()) {
        await prismaClient.questionOption.upsert({
          where: {
            questionId_order: {
              questionId: savedQuestion.id,
              order: index + 1,
            },
          },
          create: {
            questionId: savedQuestion.id,
            text: opt,
            order: index + 1,
          },
          update: {
            text: opt,
          },
        });
      }
    }
  }
}

// ==========================================
// TEST 3 — Segmented intake questionnaire (RU)
// ==========================================

interface QuestionDef {
  order: number;
  text: string;
  description?: string;
  type: QuestionType;
  required?: boolean;
  options: string[];
}

interface SegmentDef {
  title: string;
  questions: QuestionDef[];
}

const intakeTest = {
  id: 3,
  title: "Расскажи о себе — мы подберём лучший путь",
  description: "Пройдите короткую анкету, и наш ИИ составит персональный план поступления: подходящие страны, университеты и программы под ваш профиль.",
};

const intakeSegments: SegmentDef[] = [
  {
    title: "Расскажите о себе",
    questions: [
      { order: 1, text: "Имя", type: QuestionType.TEXT, options: [] },
      { order: 2, text: "Фамилия", type: QuestionType.TEXT, options: [] },
      { order: 3, text: "Почта", type: QuestionType.EMAIL, options: [] },
      { order: 4, text: "Дата рождения", type: QuestionType.DATE, options: [] },
      { order: 5, text: "Гражданство", type: QuestionType.TEXT, options: [] },
    ],
  },
  {
    title: "Какое у вас текущее образование",
    questions: [
      {
        order: 6,
        text: "Выберите ваш статус образования",
        type: QuestionType.SINGLE_CHOICE,
        options: ["Школа", "Колледж", "Бакалавриат", "Магистратура"],
      },
      {
        order: 7,
        text: "Статус",
        type: QuestionType.SINGLE_CHOICE,
        options: ["Учусь", "Закончил(а)"],
      },
    ],
  },
  {
    title: "Какой у вас академический профиль?",
    questions: [
      { order: 8, text: "Название школы/университета", type: QuestionType.TEXT, options: [] },
      { order: 9, text: "Ваши оценки и достижения", type: QuestionType.TEXT, options: [] },
      { order: 10, text: "Средний балл (GPA)", type: QuestionType.NUMERIC, options: [] },
    ],
  },
  {
    title: "На какой уровень вы планируете поступать?",
    questions: [
      {
        order: 11,
        text: "Уровень поступления",
        type: QuestionType.SINGLE_CHOICE,
        options: ["Foundation", "Бакалавриат", "Магистратура", "PhD"],
      },
    ],
  },
  {
    title: "Что вы хотите изучать?",
    questions: [
      {
        order: 12,
        text: "Направление",
        description: "Выберите направление, которое вам ближе всего",
        type: QuestionType.MULTIPLE_CHOICE,
        options: ["Бизнес и экономика", "Дизайн и искусство", "IT и Computer Science", "Гуманитарные науки", "Социальные науки", "Инженерия", "Другое"],
      },
    ],
  },
  {
    title: "В каких странах вы хотите учиться?",
    questions: [
      {
        order: 13,
        text: "Страны",
        description: "Выберите одну или несколько стран",
        type: QuestionType.MULTIPLE_CHOICE,
        options: ["Великобритания", "США", "Германия", "Нидерланды", "Канада", "Австралия", "ОАЭ", "Другое"],
      },
    ],
  },
  {
    title: "Когда вы планируете начать обучение?",
    questions: [
      {
        order: 14,
        text: "Когда вы планируете начать обучение?",
        description: "Это поможет подобрать актуальные сроки поступления",
        type: QuestionType.SINGLE_CHOICE,
        options: ["В этом году", "В следующем году", "Пока не решил(а)"],
      },
    ],
  },
  {
    title: "Какие экзамены у вас уже есть?",
    questions: [
      {
        order: 15,
        text: "Какие экзамены у вас уже есть?",
        description: "Выберите все экзамены, которые вы уже сдавали или планируете использовать",
        type: QuestionType.MULTIPLE_CHOICE,
        options: ["IELTS", "TOEFL", "Duolingo English Test", "SAT", "GRE", "GMAT", "Нет экзаменов"],
      },
    ],
  },
  {
    title: "Нужна ли вам финансовая поддержка?",
    questions: [
      {
        order: 16,
        text: "Нужна ли вам финансовая поддержка?",
        description: "Это поможет учитывать стоимость обучения и доступные стипендии",
        type: QuestionType.SINGLE_CHOICE,
        options: ["Да, обязательно", "Желательно", "Нет, не обязательно", "Пока не знаю"],
      },
    ],
  },
];

async function seedTestWithSegments(testData: { id: number; title: string; description: string }, segments: SegmentDef[]) {
  await prismaClient.test.upsert({
    where: { id: testData.id },
    create: testData,
    update: testData,
  });

  for (const seg of segments) {
    const savedSegment = await prismaClient.questionSegment.upsert({
      where: { testId_title: { testId: testData.id, title: seg.title } },
      create: { testId: testData.id, title: seg.title },
      update: { title: seg.title },
    });

    for (const question of seg.questions) {
      const savedQuestion = await prismaClient.question.upsert({
        where: { testId_order: { testId: testData.id, order: question.order } },
        create: {
          testId: testData.id,
          segmentId: savedSegment.id,
          order: question.order,
          text: question.text,
          description: question.description ?? null,
          type: question.type,
          required: question.required ?? true,
        },
        update: {
          segmentId: savedSegment.id,
          text: question.text,
          description: question.description ?? null,
          type: question.type,
          required: question.required ?? true,
        },
      });

      if (question.options.length > 0) {
        for (const [index, opt] of question.options.entries()) {
          await prismaClient.questionOption.upsert({
            where: { questionId_order: { questionId: savedQuestion.id, order: index + 1 } },
            create: { questionId: savedQuestion.id, text: opt, order: index + 1 },
            update: { text: opt },
          });
        }
      }
    }
  }
}

export async function seedTestsAndQuestions() {
  await seedTest(test, questionsData);
  await seedTest(testRu, questionsDataRu);
  await seedTestWithSegments(intakeTest, intakeSegments);
}
