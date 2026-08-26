import type { JwtPayloadDto } from "./api/dtos/jwt-payload.dto";

/**
 * JWT `sub` is often a string; access payload may use `id`. Never pass undefined into Prisma.
 */
export function resolveUserIdFromJwtPayload(payload: JwtPayloadDto | Record<string, unknown>): number | null {
  const p = payload as Record<string, unknown>;
  const raw = p["sub"] ?? p["id"];
  if (raw === undefined || raw === null) return null;
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}
