import { Decimal } from "@prisma/client/runtime/index-browser";

function isPlainObject(value: any): value is Record<string, any> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

export function decimalsToNumbers<T>(data: T): T {
  if (data == null) return data;

  // Prisma Decimal -> number
  if (data instanceof Decimal) {
    return Number(data) as unknown as T;
  }

  // Date: вернуть как есть (Nest JSON отдаст ISO-строку)
  if (data instanceof Date) {
    return data;
  }

  // Массивы
  if (Array.isArray(data)) {
    return data.map(item => decimalsToNumbers(item)) as unknown as T;
  }

  // Обычные объекты (не Date/Map/Set/etc)
  if (isPlainObject(data)) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      out[k] = decimalsToNumbers(v);
    }
    return out as T;
  }

  return data;
}
