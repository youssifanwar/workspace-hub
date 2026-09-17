import { NextResponse } from "next/server";

import {
  eq,
} from "drizzle-orm";

import { db } from "@/db";

import {
  auditLogs,
  bankTransactions,
  shifts,
} from "@/db/schema";

import {
  getCurrentUser,
} from "@/lib/auth";

import {
  getActiveShiftForUser,
} from "@/lib/shift";

export const dynamic =
  "force-dynamic";

/* ============================================================================
 * TYPES
 * ========================================================================== */

type BankTransactionType =
  | "deposit"
  | "withdraw";

type CreateBankTransactionBody = {
  type?: unknown;
  amount?: unknown;
  note?: unknown;
};

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const MAX_NOTE_LENGTH = 5000;

const MAX_AMOUNT_CENTS =
  999999999999;

/* ============================================================================
 * HELPERS
 * ========================================================================== */

function parsePositiveAmount(
  value: unknown,
): number | null {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed =
    typeof value === "number"
      ? value
      : Number(
          String(value).trim(),
        );

  if (
    !Number.isFinite(parsed) ||
    parsed <= 0
  ) {
    return null;
  }

  const cents =
    Math.round(
      parsed * 100,
    );

  if (
    !Number.isSafeInteger(
      cents,
    ) ||
    cents <= 0 ||
    cents >
      MAX_AMOUNT_CENTS
  ) {
    return null;
  }

  return cents / 100;
}

function parseTransactionType(
  value: unknown,
): BankTransactionType | null {
  if (
    value === "deposit" ||
    value === "withdraw"
  ) {
    return value;
  }

  return null;
}

function parseOptionalNote(
  value: unknown,
): string | null {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  if (
    typeof value !== "string"
  ) {
    return null;
  }

  const note =
    value.trim();

  if (!note) {
    return null;
  }

  if (
    note.length >
    MAX_NOTE_LENGTH
  ) {
    return null;
  }

  return note;
}

/* ============================================================================
 * POST
 *
 * Create a bank deposit/withdrawal for the current active shift.
 * ========================================================================== */

export async function POST(
  req: Request,
) {
  try {
    /* ------------------------------------------------------------------------
     * AUTH
     * ---------------------------------------------------------------------- */

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

    /* ------------------------------------------------------------------------
     * BODY
     * ---------------------------------------------------------------------- */

    const body =
      (
        await req
          .json()
          .catch(
            () => null,
          )
      ) as
        | CreateBankTransactionBody
        | null;

    if (!body) {
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

    /* ------------------------------------------------------------------------
     * TYPE
     * ---------------------------------------------------------------------- */

    const type =
      parseTransactionType(
        body.type,
      );

    if (!type) {
      return NextResponse.json(
        {
          error:
            "Transaction type must be deposit or withdraw.",
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * AMOUNT
     * ---------------------------------------------------------------------- */

    const amount =
      parsePositiveAmount(
        body.amount,
      );

    if (amount === null) {
      return NextResponse.json(
        {
          error:
            "Positive valid amount is required.",
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * NOTE
     * ---------------------------------------------------------------------- */

    const note =
      parseOptionalNote(
        body.note,
      );

    if (
      body.note !==
        undefined &&
      body.note !==
        null &&
      typeof body.note !==
        "string"
    ) {
      return NextResponse.json(
        {
          error:
            "Transaction note must be text.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      typeof body.note ===
        "string" &&
      body.note.trim()
        .length >
        MAX_NOTE_LENGTH
    ) {
      return NextResponse.json(
        {
          error:
            `Transaction note cannot exceed ${MAX_NOTE_LENGTH} characters.`,
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * ACTIVE SHIFT - EARLY CHECK
     *
     * This is only for fast user feedback.
     * The authoritative check happens inside the transaction.
     * ---------------------------------------------------------------------- */

    const shift =
      await getActiveShiftForUser(
        user.id,
      );

    if (!shift) {
      return NextResponse.json(
        {
          error:
            "No active shift.",
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * TRANSACTION
     *
     * Lock the shift row before recording the bank transaction.
     *
     * The current schema uses:
     *
     * - openedAt
     * - closedAt
     *
     * so a shift is considered active when closedAt is NULL.
     * ---------------------------------------------------------------------- */

    const result =
      await db.transaction(
        async (tx) => {
          const lockedRows =
            await tx
              .select({
                id:
                  shifts.id,

                userId:
                  shifts.userId,

                openedAt:
                  shifts.openedAt,

                closedAt:
                  shifts.closedAt,
              })
              .from(
                shifts,
              )
              .where(
                eq(
                  shifts.id,
                  shift.id,
                ),
              )
              .limit(1)
              .for(
                "update",
              );

          const lockedShift =
            lockedRows[0];

          if (!lockedShift) {
            throw new Error(
              "SHIFT_NOT_FOUND",
            );
          }

          if (
            lockedShift.userId !==
            user.id
          ) {
            throw new Error(
              "SHIFT_PERMISSION_DENIED",
            );
          }

          if (
            lockedShift.closedAt !==
              null &&
            lockedShift.closedAt !==
              undefined
          ) {
            throw new Error(
              "SHIFT_NOT_ACTIVE",
            );
          }

          /* ------------------------------------------------------------------
           * INSERT
           * ---------------------------------------------------------------- */

          const [
            created,
          ] =
            await tx
              .insert(
                bankTransactions,
              )
              .values({
                shiftId:
                  lockedShift.id,

                userId:
                  user.id,

                type,

                amount:
                  amount.toFixed(2),

                note,
              })
              .returning({
                id:
                  bankTransactions.id,

                shiftId:
                  bankTransactions.shiftId,

                userId:
                  bankTransactions.userId,

                type:
                  bankTransactions.type,

                amount:
                  bankTransactions.amount,

                note:
                  bankTransactions.note,

                createdAt:
                  bankTransactions.createdAt,
              });

          if (!created) {
            throw new Error(
              "Could not create bank transaction.",
            );
          }

          /* ------------------------------------------------------------------
           * AUDIT LOG
           * ---------------------------------------------------------------- */

          await tx
            .insert(
              auditLogs,
            )
            .values({
              userId:
                user.id,

              action:
                "bank_transaction_created",

              entityType:
                "bank_transaction",

              entityId:
                created.id,

              details: {
                bankTransactionId:
                  created.id,

                shiftId:
                  created.shiftId,

                type:
                  created.type,

                amount:
                  Number(
                    created.amount,
                  ),

                note:
                  created.note,
              },
            });

          return created;
        },
      );

    /* ------------------------------------------------------------------------
     * RESPONSE
     * ---------------------------------------------------------------------- */

    return NextResponse.json(
      {
        ok: true,

        transaction: {
          id:
            result.id,

          shiftId:
            result.shiftId,

          userId:
            result.userId,

          type:
            result.type,

          amount:
            result.amount,

          note:
            result.note,

          createdAt:
            result.createdAt.toISOString(),
        },
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    /* ------------------------------------------------------------------------
     * BUSINESS ERRORS
     * ---------------------------------------------------------------------- */

    if (
      error instanceof Error
    ) {
      if (
        error.message ===
        "SHIFT_NOT_FOUND"
      ) {
        return NextResponse.json(
          {
            error:
              "The active shift is no longer available.",
          },
          {
            status: 409,
          },
        );
      }

      if (
        error.message ===
        "SHIFT_PERMISSION_DENIED"
      ) {
        return NextResponse.json(
          {
            error:
              "You are not allowed to use this shift.",
          },
          {
            status: 403,
          },
        );
      }

      if (
        error.message ===
        "SHIFT_NOT_ACTIVE"
      ) {
        return NextResponse.json(
          {
            error:
              "The shift is already closed.",
          },
          {
            status: 409,
          },
        );
      }
    }

    /* ------------------------------------------------------------------------
     * INTERNAL ERROR
     * ---------------------------------------------------------------------- */

    console.error(
      "Create bank transaction error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not create bank transaction.",
      },
      {
        status: 500,
      },
    );
  }
}