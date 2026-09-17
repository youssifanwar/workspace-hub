import { NextResponse } from "next/server";

import {
  eq,
  sql,
} from "drizzle-orm";

import { db } from "@/db";

import { shifts } from "@/db/schema";

import { getCurrentUser } from "@/lib/auth";

import { getActiveShiftForUser } from "@/lib/shift";

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
      "Opening cash must be a valid number.",
      400,
    );
  }

  if (
    number < 0
  ) {
    throw new ApiError(
      "Opening cash cannot be negative.",
      400,
    );
  }

  /*
   * PostgreSQL numeric(12,2) can safely store this range.
   * Keep two decimal places for cash values.
   */
  if (
    number >
    9999999999.99
  ) {
    throw new ApiError(
      "Opening cash is too large.",
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
            openingCash?: number;
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
    /* OPENING CASH                                                           */
    /* ---------------------------------------------------------------------- */

    const openingCash =
      parseMoney(
        body.openingCash ??
          0,
      );

    /* ---------------------------------------------------------------------- */
    /* NOTE                                                                   */
    /* ---------------------------------------------------------------------- */

    const note =
      normalizeNote(
        body.note,
      );

    /* ---------------------------------------------------------------------- */
    /* TRANSACTION                                                            */
    /* ---------------------------------------------------------------------- */

    const shift =
      await db.transaction(
        async (tx) => {
          /*
           * Serialize shift creation for this user.
           *
           * Without this lock, two simultaneous requests can both execute
           * getActiveShiftForUser() before either INSERT commits.
           */
          await tx.execute(
            sql`
              SELECT pg_advisory_xact_lock(
                ${user.id}
              )
            `,
          );

          /* -------------------------------------------------------------- */
          /* ACTIVE SHIFT CHECK                                               */
          /* -------------------------------------------------------------- */

          const existing =
            await getActiveShiftForUser(
              user.id,
            );

          if (existing) {
            throw new ApiError(
              "You already have an active shift.",
              409,
            );
          }

          /* -------------------------------------------------------------- */
          /* CREATE SHIFT                                                      */
          /* -------------------------------------------------------------- */

          const inserted =
            await tx
              .insert(
                shifts,
              )
              .values({
                userId:
                  user.id,

                openingCash:
                  openingCash.toFixed(
                    2,
                  ),

                note,
              })
              .returning({
                id:
                  shifts.id,
              });

          const row =
            inserted[0];

          if (!row) {
            throw new ApiError(
              "Could not create shift.",
              500,
            );
          }

          return row;
        },
      );

    /* ---------------------------------------------------------------------- */
    /* RESPONSE                                                               */
    /* ---------------------------------------------------------------------- */

    return NextResponse.json(
      {
        ok: true,

        shiftId:
          shift.id,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error(
      "Create shift error:",
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
          "Could not create shift.",
      },
      {
        status: 500,
      },
    );
  }
}