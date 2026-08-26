import { prismaClient } from "./prisma-client";

const permissions = [
  // Student / Schoolboy
  { id: 1, name: "View AI Plan", code: "VIEW_AI_PLAN", description: "Доступ к AI-плану" },
  { id: 2, name: "Book Meeting", code: "BOOK_MEETING", description: "Бронирование встреч" },
  { id: 3, name: "Upload Document", code: "UPLOAD_DOCUMENT", description: "Загрузка документов" },
  { id: 4, name: "Chat with Expert", code: "CHAT_WITH_EXPERT", description: "Чат с закрепленным экспертом" },
  // Consultant
  { id: 5, name: "View CRM", code: "VIEW_CRM", description: "Доступ к CRM-доске" },
  { id: 6, name: "Manage Application Status", code: "MANAGE_APPLICATION_STATUS", description: "Управление статусами заявок" },
  { id: 7, name: "Review Document", code: "REVIEW_DOCUMENT", description: "Ревью документов" },
  { id: 8, name: "Create Event", code: "CREATE_EVENT", description: "Создание O2O-мероприятий (QR-коды)" },
  // Admin
  { id: 9, name: "View Finance", code: "VIEW_FINANCE", description: "Финансовая аналитика" },
  { id: 10, name: "Manage References", code: "MANAGE_REFERENCES", description: "Модерация справочников (Вузы/Страны)" },
  { id: 11, name: "Resolve Disputes", code: "RESOLVE_DISPUTES", description: "Разрешение споров" },
  { id: 12, name: "Manage Promocodes", code: "MANAGE_PROMOCODES", description: "Управление промокодами" },
];

const studentPermissionIds = [1, 2, 3, 4];
const consultantPermissionIds = [5, 6, 7, 8];
const allPermissionIds = permissions.map(p => p.id);

const roles = [
  { id: 1, name: "Admin", code: "ADMIN", description: "Полный доступ (Режим Бога)", permissionIds: allPermissionIds },
  { id: 2, name: "Expert", code: "EXPERT", description: "Эксперт-консультант", permissionIds: consultantPermissionIds },
  { id: 3, name: "Student", code: "STUDENT", description: "Студент ВУЗа", permissionIds: studentPermissionIds },
  { id: 4, name: "Schoolboy", code: "SCHOOLBOY", description: "Ученик школы", permissionIds: studentPermissionIds },
];

export async function seedRolesAndPermissions() {
  await prismaClient.permission.createMany({
    data: permissions,
    skipDuplicates: true,
  });

  for (const role of roles) {
    await prismaClient.role.upsert({
      where: { id: role.id },
      update: {
        name: role.name,
        code: role.code,
        description: role.description,
        permissions: {
          set: role.permissionIds.map(id => ({ id })),
        },
      },
      create: {
        id: role.id,
        name: role.name,
        code: role.code,
        description: role.description,
        permissions: {
          connect: role.permissionIds.map(id => ({ id })),
        },
      },
    });
  }
}
