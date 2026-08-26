import { prismaClient } from "./prisma-client";

const permissions = [
  // Student / Schoolboy
  { preferredId: 1, name: "View AI Plan", code: "VIEW_AI_PLAN", description: "Доступ к AI-плану" },
  { preferredId: 2, name: "Book Meeting", code: "BOOK_MEETING", description: "Бронирование встреч" },
  { preferredId: 3, name: "Upload Document", code: "UPLOAD_DOCUMENT", description: "Загрузка документов" },
  { preferredId: 4, name: "Chat with Expert", code: "CHAT_WITH_EXPERT", description: "Чат с закрепленным экспертом" },
  // Consultant
  { preferredId: 5, name: "View CRM", code: "VIEW_CRM", description: "Доступ к CRM-доске" },
  { preferredId: 6, name: "Manage Application Status", code: "MANAGE_APPLICATION_STATUS", description: "Управление статусами заявок" },
  { preferredId: 7, name: "Review Document", code: "REVIEW_DOCUMENT", description: "Ревью документов" },
  { preferredId: 8, name: "Create Event", code: "CREATE_EVENT", description: "Создание O2O-мероприятий (QR-коды)" },
  // Admin
  { preferredId: 9, name: "View Finance", code: "VIEW_FINANCE", description: "Финансовая аналитика" },
  { preferredId: 10, name: "Manage References", code: "MANAGE_REFERENCES", description: "Модерация справочников (Вузы/Страны)" },
  { preferredId: 11, name: "Resolve Disputes", code: "RESOLVE_DISPUTES", description: "Разрешение споров" },
  { preferredId: 12, name: "Manage Promocodes", code: "MANAGE_PROMOCODES", description: "Управление промокодами" },
  // Sales Manager
  { preferredId: 13, name: "View Unassigned Leads", code: "SALES_LEADS_READ_UNASSIGNED", description: "Просмотр общей очереди новых лидов" },
  { preferredId: 14, name: "Create Sales Lead", code: "SALES_LEADS_CREATE", description: "Ручное создание лидов" },
  { preferredId: 15, name: "Accept Sales Lead", code: "SALES_LEADS_ACCEPT", description: "Принятие лида в работу" },
  { preferredId: 16, name: "Manage Own Sales Leads", code: "SALES_LEADS_MANAGE_OWN", description: "Работа только со своими лидами" },
  { preferredId: 17, name: "View Expert Availability", code: "SALES_EXPERTS_READ_SLOTS", description: "Просмотр свободных слотов экспертов" },
  { preferredId: 18, name: "View Sales Notifications", code: "SALES_NOTIFICATIONS_READ", description: "Просмотр уведомлений Sales Manager" },
  // Expert
  { preferredId: 19, name: "Respond to Lead Calls", code: "EXPERT_LEAD_CALLS_RESPOND", description: "Работа с запросами на созвон от Sales Manager" },
];

const studentPermissionCodes = ["VIEW_AI_PLAN", "BOOK_MEETING", "UPLOAD_DOCUMENT", "CHAT_WITH_EXPERT"];
const consultantPermissionCodes = ["VIEW_CRM", "MANAGE_APPLICATION_STATUS", "REVIEW_DOCUMENT", "CREATE_EVENT", "EXPERT_LEAD_CALLS_RESPOND"];
const salesManagerPermissionCodes = [
  "SALES_LEADS_READ_UNASSIGNED",
  "SALES_LEADS_CREATE",
  "SALES_LEADS_ACCEPT",
  "SALES_LEADS_MANAGE_OWN",
  "SALES_EXPERTS_READ_SLOTS",
  "SALES_NOTIFICATIONS_READ",
];

const roles = [
  { preferredId: 1, name: "Admin", code: "ADMIN", description: "Полный доступ (Режим Бога)", permissionCodes: permissions.map(item => item.code) },
  { preferredId: 2, name: "Expert", code: "EXPERT", description: "Эксперт-консультант", permissionCodes: consultantPermissionCodes },
  { preferredId: 3, name: "Student", code: "STUDENT", description: "Студент ВУЗа", permissionCodes: studentPermissionCodes },
  { preferredId: 4, name: "Schoolboy", code: "SCHOOLBOY", description: "Ученик школы", permissionCodes: studentPermissionCodes },
  { preferredId: 5, name: "Sales Manager", code: "SALES_MANAGER", description: "Менеджер по продажам", permissionCodes: salesManagerPermissionCodes },
];

async function availablePermissionId(preferredId: number) {
  const owner = await prismaClient.permission.findUnique({ where: { id: preferredId }, select: { id: true } });
  if (!owner) return preferredId;
  const aggregate = await prismaClient.permission.aggregate({ _max: { id: true } });
  return (aggregate._max.id ?? 0) + 1;
}

async function availableRoleId(preferredId: number) {
  const owner = await prismaClient.role.findUnique({ where: { id: preferredId }, select: { id: true } });
  if (!owner) return preferredId;
  const aggregate = await prismaClient.role.aggregate({ _max: { id: true } });
  return (aggregate._max.id ?? 0) + 1;
}

export async function seedRolesAndPermissions() {
  const permissionIds = new Map<string, number>();

  for (const permission of permissions) {
    const existing = await prismaClient.permission.findUnique({ where: { code: permission.code }, select: { id: true } });
    const record = existing
      ? await prismaClient.permission.update({
          where: { code: permission.code },
          data: { name: permission.name, description: permission.description, deletedAt: null },
        })
      : await prismaClient.permission.create({
          data: {
            id: await availablePermissionId(permission.preferredId),
            name: permission.name,
            code: permission.code,
            description: permission.description,
          },
        });
    permissionIds.set(record.code, record.id);
  }

  for (const role of roles) {
    const permissionConnections = role.permissionCodes.map(code => ({ id: permissionIds.get(code)! }));
    const existing = await prismaClient.role.findUnique({ where: { code: role.code }, select: { id: true } });

    if (existing) {
      await prismaClient.role.update({
        where: { code: role.code },
        data: {
          name: role.name,
          description: role.description,
          deletedAt: null,
          permissions: { set: permissionConnections },
        },
      });
      continue;
    }

    await prismaClient.role.create({
      data: {
        id: await availableRoleId(role.preferredId),
        name: role.name,
        code: role.code,
        description: role.description,
        permissions: { connect: permissionConnections },
      },
    });
  }

  await prismaClient.$queryRaw`SELECT setval(pg_get_serial_sequence('"Permission"', 'id'), COALESCE((SELECT MAX("id") FROM "Permission"), 1), EXISTS (SELECT 1 FROM "Permission"))`;
  await prismaClient.$queryRaw`SELECT setval(pg_get_serial_sequence('"Role"', 'id'), COALESCE((SELECT MAX("id") FROM "Role"), 1), EXISTS (SELECT 1 FROM "Role"))`;
}
