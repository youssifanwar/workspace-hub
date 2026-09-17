import { db } from "@/db";

import { shifts } from "@/db/schema";

import {
  and,
  desc,
  eq,
  isNull,
} from "drizzle-orm";

export type ActiveShift = {
  id: number;
  userId: number;
  openedAt: Date;
  openingCash: string;
};

/* -------------------------------------------------------------------------- */
/* MAP SHIFT                                                                   */
/* -------------------------------------------------------------------------- */

function mapActiveShift(
  row:
    | {
        id: number;
        userId: number;
        openedAt: Date;
        openingCash: string;
      }
    | undefined,
): ActiveShift | null {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.userId,
    openedAt: row.openedAt,
    openingCash: row.openingCash,
  };
}

/* -------------------------------------------------------------------------- */
/* GET ACTIVE SHIFT FOR USER                                                   */
/* -------------------------------------------------------------------------- */

export async function getActiveShiftForUser(
  userId: number,
): Promise<ActiveShift | null> {
  if (
    !Number.isSafeInteger(
      userId,
    ) ||
    userId <= 0
  ) {
    return null;
  }

  const rows =
    await db
      .select({
        id:
          shifts.id,

        userId:
          shifts.userId,

        openedAt:
          shifts.openedAt,

        openingCash:
          shifts.openingCash,
      })
      .from(
        shifts,
      )
      .where(
        and(
          eq(
            shifts.userId,
            userId,
          ),

          isNull(
            shifts.closedAt,
          ),
        ),
      )
      .orderBy(
        desc(
          shifts.openedAt,
        ),
        desc(
          shifts.id,
        ),
      )
      .limit(1);

  return mapActiveShift(
    rows[0],
  );
}

/* -------------------------------------------------------------------------- */
/* GET ANY ACTIVE SHIFT                                                        */
/* -------------------------------------------------------------------------- */

export async function getAnyActiveShift(): Promise<
  ActiveShift | null
> {
  const rows =
    await db
      .select({
        id:
          shifts.id,

        userId:
          shifts.userId,

        openedAt:
          shifts.openedAt,

        openingCash:
          shifts.openingCash,
      })
      .from(
        shifts,
      )
      .where(
        isNull(
          shifts.closedAt,
        ),
      )
      .orderBy(
        desc(
          shifts.openedAt,
        ),
        desc(
          shifts.id,
        ),
      )
      .limit(1);

  return mapActiveShift(
    rows[0],
  );
}