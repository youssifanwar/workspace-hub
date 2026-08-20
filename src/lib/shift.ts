import { db } from "@/db";
import { shifts } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";

export type ActiveShift = {
  id: number;
  userId: number;
  openedAt: Date;
  openingCash: string;
};

export async function getActiveShiftForUser(
  userId: number,
): Promise<ActiveShift | null> {
  const rows = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.userId, userId), isNull(shifts.closedAt)))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    userId: r.userId,
    openedAt: r.openedAt,
    openingCash: r.openingCash,
  };
}

export async function getAnyActiveShift(): Promise<ActiveShift | null> {
  const rows = await db
    .select()
    .from(shifts)
    .where(isNull(shifts.closedAt))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    userId: r.userId,
    openedAt: r.openedAt,
    openingCash: r.openingCash,
  };
}
