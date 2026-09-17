import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";

import { db } from "@/db";

import {
  auditLogs,
  expenses,
  shifts,
} from "@/db/schema";

import { getCurrentUser } from "@/lib/auth";

import { getActiveShiftForUser } from "@/lib/shift";

export const dynamic = "force-dynamic";

/* ============================================================================
 * TYPES
 * ========================================================================== */

type CreateExpenseBody = {
  amount?: unknown;
  category?: unknown;
  note?: unknown;
};

/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const MAX_AMOUNT_CENTS =
  999999999999;

const MAX_CATEGORY_LENGTH = 100;

const MAX_NOTE_LENGTH = 5000;

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
      : Number(String(value).trim());

  if (
    !Number.isFinite(parsed) ||
    parsed <= 0
  ) {
    return null;
  }

  const cents =
    Math.round(parsed * 100);

  if (
    !Number.isSafeInteger(cents) ||
    cents <= 0 ||
    cents > MAX_AMOUNT_CENTS
  ) {
    return null;
  }

  return cents / 100;
}

function normalizeCategory(
  value: unknown,
): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "General";
  }

  if (
    typeof value !== "string"
  ) {
    return "";
  }

  const category =
    value.trim();

  if (!category) {
    return "General";
  }

  if (
    category.length >
    MAX_CATEGORY_LENGTH
  ) {
    return "";
  }

  return category;
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
 * POST - CREATE EXPENSE
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
     * REQUEST BODY
     * ---------------------------------------------------------------------- */

    const body =
      (
        await req
          .json()
          .catch(() => null)
      ) as CreateExpenseBody | null;

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
     * CATEGORY
     * ---------------------------------------------------------------------- */

    const category =
      normalizeCategory(
        body.category,
      );

    if (!category) {
      return NextResponse.json(
        {
          error:
            `Expense category must be between 1 and ${MAX_CATEGORY_LENGTH} characters.`,
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
      normalizeNote(
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
            "Expense note must be text.",
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
            `Expense note cannot exceed ${MAX_NOTE_LENGTH} characters.`,
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * ACTIVE SHIFT
     *
     * This is an early check for fast feedback.
     * The definitive check is repeated inside the transaction.
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
     * We lock the shift row before inserting the expense.
     *
     * This prevents:
     *
     * 1. An expense being inserted against a shift while it is being closed.
     * 2. A race between two operations using the same shift.
     * ---------------------------------------------------------------------- */

    const result =
      await db.transaction(
        async (tx) => {
          const lockedShiftRows =
            await tx.execute(
              sql`
                SELECT
                  id,
                  user_id,
                  status
                FROM shifts
                WHERE
                  id = ${shift.id}
                  AND user_id = ${user.id}
                FOR UPDATE
              `,
            );

          const lockedShift =
            lockedShiftRows.rows?.[0] as
              | {
                  id?: unknown;
                  user_id?: unknown;
                  status?: unknown;
                }
              | undefined;

          if (!lockedShift) {
            throw new Error(
              "SHIFT_NOT_FOUND",
            );
          }

          if (
            lockedShift.user_id !==
            user.id
          ) {
            throw new Error(
              "SHIFT_PERMISSION_DENIED",
            );
          }

          if (
            lockedShift.status !==
            "open"
          ) {
            throw new Error(
              "SHIFT_NOT_ACTIVE",
            );
          }

          /* ------------------------------------------------------------------
           * INSERT EXPENSE
           * ---------------------------------------------------------------- */

          const [createdExpense] =
            await tx
              .insert(expenses)
              .values({
                shiftId:
                  shift.id,

                userId:
                  user.id,

                amount:
                  amount.toFixed(2),

                category,

                note,
              })
              .returning({
                id:
                  expenses.id,

                shiftId:
                  expenses.shiftId,

                userId:
                  expenses.userId,

                amount:
                  expenses.amount,

                category:
                  expenses.category,

                note:
                  expenses.note,

                createdAt:
                  expenses.createdAt,
              });

          if (!createdExpense) {
            throw new Error(
              "Could not create expense.",
            );
          }

          /* ------------------------------------------------------------------
           * AUDIT
           * ------------------------------------------------------------------ */

          await tx
            .insert(auditLogs)
            .values({
              userId:
                user.id,

              action:
                "expense_created",

              entityType:
                "expense",

              entityId:
                createdExpense.id,

              details: {
                expenseId:
                  createdExpense.id,

                shiftId:
                  createdExpense.shiftId,

                amount:
                  Number(
                    createdExpense.amount,
                  ),

                category:
                  createdExpense.category,

                note:
                  createdExpense.note,
              },
            });

          return createdExpense;
        },
      );

    /* ------------------------------------------------------------------------
     * RESPONSE
     * ---------------------------------------------------------------------- */

    return NextResponse.json(
      {
        ok: true,

        expense: {
          id:
            result.id,

          shiftId:
            result.shiftId,

          userId:
            result.userId,

          amount:
            result.amount,

          category:
            result.category,

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
     * EXPECTED BUSINESS ERRORS
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
              "You are not allowed to add an expense to this shift.",
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
      "Create expense error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not create expense.",
      },
      {
        status: 500,
      },
    );
  }
}