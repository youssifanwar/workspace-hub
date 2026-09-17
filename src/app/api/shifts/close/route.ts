import { NextResponse } from "next/server";

import {
  and,
  eq,
  sql,
} from "drizzle-orm";

import { db } from "@/db";

import {
  shifts,
  bookings,
} from "@/db/schema";

import {
  getCurrentUser,
} from "@/lib/auth";

export const dynamic =
  "force-dynamic";

class ApiError extends Error {
  status: number;

  constructor(
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function parseMoney(
  value: unknown,
): number {
  const number =
    Number(value);

  if (
    !Number.isFinite(
      number,
    )
  ) {
    throw new ApiError(
      "Closing cash must be a valid number.",
      400,
    );
  }

  if (
    number < 0
  ) {
    throw new ApiError(
      "Closing cash cannot be negative.",
      400,
    );
  }

  if (
    number >
    9999999999.99
  ) {
    throw new ApiError(
      "Closing cash is too large.",
      400,
    );
  }

  return number;
}

function normalizeNote(
  value: unknown,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value !==
    "string"
  ) {
    throw new ApiError(
      "Invalid shift note.",
      400,
    );
  }

  const note =
    value.trim();

  if (
    note.length >
    2000
  ) {
    throw new ApiError(
      "Shift note is too long.",
      400,
    );
  }

  return note ||
    null;
}

export async function POST(
  req: Request,
) {
  try {
    /* ---------------------------------------------------------------------- */
    /* AUTH                                                                   */
    /* ---------------------------------------------------------------------- */

    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error:
            "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* REQUEST BODY                                                            */
    /* ---------------------------------------------------------------------- */

    const body =
      (await req
        .json()
        .catch(
          () => null,
        )) as
        | {
            closingCash?: number;
            note?: string;
          }
        | null;

    if (
      body === null
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid request body.",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* CASH + NOTE                                                            */
    /* ---------------------------------------------------------------------- */

    const closingCash =
      parseMoney(
        body.closingCash ??
          0,
      );

    const note =
      normalizeNote(
        body.note,
      );

    /* ---------------------------------------------------------------------- */
    /* TRANSACTION                                                            */
    /* ---------------------------------------------------------------------- */

    const result =
      await db.transaction(
        async (tx) => {
          /* ---------------------------------------------------------------- */
          /* USER SHIFT LOCK                                                   */
          /* ---------------------------------------------------------------- */

          /*
           * Serialize opening/closing operations for this user.
           * This prevents two close requests from racing each other,
           * and also coordinates with the shift creation lock.
           */
          await tx.execute(
            sql`
              SELECT pg_advisory_xact_lock(
                ${user.id}
              )
            `,
          );

          /* ---------------------------------------------------------------- */
          /* FIND ACTIVE SHIFT                                                 */
          /* ---------------------------------------------------------------- */

          const activeRows =
            await tx
              .select({
                id:
                  shifts.id,

                userId:
                  shifts.userId,

                openingCash:
                  shifts.openingCash,

                note:
                  shifts.note,
              })
              .from(
                shifts,
              )
              .where(
                and(
                  eq(
                    shifts.userId,
                    user.id,
                  ),

                  sql`${shifts.closedAt} IS NULL`,
                ),
              )
              .orderBy(
                sql`${shifts.id} DESC`,
              )
              .limit(1);

          const active =
            activeRows[0];

          if (!active) {
            throw new ApiError(
              "No active shift to close.",
              400,
            );
          }

          /* ---------------------------------------------------------------- */
          /* LOCK SHIFT ROW                                                    */
          /* ---------------------------------------------------------------- */

          await tx.execute(
            sql`
              SELECT 1
              FROM shifts
              WHERE id = ${active.id}
              FOR UPDATE
            `,
          );

          /* ---------------------------------------------------------------- */
          /* ACTIVE BOOKINGS                                                   */
          /* ---------------------------------------------------------------- */

          const openBookings =
            await tx
              .select({
                id:
                  bookings.id,
              })
              .from(
                bookings,
              )
              .where(
                and(
                  eq(
                    bookings.shiftId,
                    active.id,
                  ),

                  eq(
                    bookings.status,
                    "active",
                  ),
                ),
              );

          if (
            openBookings.length >
            0
          ) {
            throw new ApiError(
              `Cannot close shift: ${openBookings.length} booking(s) are still active. Please check them out first.`,
              409,
            );
          }

          /* ---------------------------------------------------------------- */
          /* CLOSE SHIFT                                                       */
          /* ---------------------------------------------------------------- */

          const closedAt =
            new Date();

          const updateData: {
            closedAt: Date;
            closingCash: string;
            note?: string | null;
          } = {
            closedAt,

            closingCash:
              closingCash.toFixed(
                2,
              ),
          };

          /*
           * Preserve the existing note when no new note was supplied.
           * When a note is explicitly sent, save the normalized value.
           */
          if (
            body.note !==
            undefined
          ) {
            updateData.note =
              note;
          }

          const updated =
            await tx
              .update(
                shifts,
              )
              .set(
                updateData,
              )
              .where(
                and(
                  eq(
                    shifts.id,
                    active.id,
                  ),

                  eq(
                    shifts.userId,
                    user.id,
                  ),

                  sql`${shifts.closedAt} IS NULL`,
                ),
              )
              .returning({
                id:
                  shifts.id,

                closedAt:
                  shifts.closedAt,

                closingCash:
                  shifts.closingCash,
              });

          const row =
            updated[0];

          if (!row) {
            throw new ApiError(
              "The shift was already closed.",
              409,
            );
          }

          /* ---------------------------------------------------------------- */
          /* RESULT                                                            */
          /* ---------------------------------------------------------------- */

          return {
            shiftId:
              row.id,

            closedAt:
              row.closedAt,

            closingCash:
              Number(
                row.closingCash,
              ),
          };
        },
      );

    /* ---------------------------------------------------------------------- */
    /* RESPONSE                                                               */
    /* ---------------------------------------------------------------------- */

    return NextResponse.json(
      {
        ok: true,

        shiftId:
          result.shiftId,

        closedAt:
          result.closedAt
            ? result.closedAt.toISOString()
            : null,

        closingCash:
          result.closingCash,
      },
      {
        status: 200,
      },
    );
  } catch (error) {
    console.error(
      "Close shift error:",
      error,
    );

    if (
      error instanceof
      ApiError
    ) {
      return NextResponse.json(
        {
          error:
            error.message,
        },
        {
          status:
            error.status,
        },
      );
    }

    return NextResponse.json(
      {
        error:
          "Could not close shift.",
      },
      {
        status: 500,
      },
    );
  }
}