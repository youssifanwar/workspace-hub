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
  expenses,
  bankTransactions,
  auditLogs,
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
          /* CASH RECONCILIATION                                               */
          /* ---------------------------------------------------------------- */

          /*
           * Expected cash must be calculated from the same sources used by
           * Shift Summary:
           *
           * opening cash
           * + closed customer-session cash sales
           * + direct F&B cash sales
           * - shift expenses
           * - bank deposits
           * + bank withdrawals
           *
           * The calculation happens inside the same transaction and while
           * the shift row is locked, so the number being reconciled is the
           * number that is actually used to close this shift.
           */

          const [bookingCashRow] =
            await tx
              .select({
                total: sql<string>`
                  coalesce(
                    sum(${bookings.total}),
                    0
                  )
                `,
              })
              .from(bookings)
              .where(
                and(
                  eq(
                    bookings.shiftId,
                    active.id,
                  ),
                  eq(
                    bookings.status,
                    "closed",
                  ),
                  eq(
                    bookings.paymentMethod,
                    "cash",
                  ),
                ),
              );

          const directFnbCashResult =
            await tx.execute(
              sql`
                SELECT
                  COALESCE(SUM(total), 0) AS total
                FROM fnb_sales
                WHERE
                  shift_id = ${active.id}
                  AND payment_method = 'cash'
              `,
            );

          const directFnbCashRow =
            (
              directFnbCashResult as {
                rows?: Array<
                  Record<string, unknown>
                >;
              }
            ).rows?.[0];

          const expensesResult =
            await tx
              .select({
                total: sql<string>`
                  coalesce(
                    sum(${expenses.amount}),
                    0
                  )
                `,
              })
              .from(expenses)
              .where(
                eq(
                  expenses.shiftId,
                  active.id,
                ),
              );

          const bankResult =
            await tx
              .select({
                deposits: sql<string>`
                  coalesce(
                    sum(
                      case
                        when ${bankTransactions.type} = 'deposit'
                        then ${bankTransactions.amount}
                        else 0
                      end
                    ),
                    0
                  )
                `,
                withdrawals: sql<string>`
                  coalesce(
                    sum(
                      case
                        when ${bankTransactions.type} = 'withdraw'
                        then ${bankTransactions.amount}
                        else 0
                      end
                    ),
                    0
                  )
                `,
              })
              .from(bankTransactions)
              .where(
                eq(
                  bankTransactions.shiftId,
                  active.id,
                ),
              );

          const openingCash =
            Number(
              active.openingCash ?? 0,
            );

          const cashSales =
            Number(
              bookingCashRow?.total ?? 0,
            ) +
            Number(
              directFnbCashRow?.total ?? 0,
            );

          const expenseTotal =
            Number(
              expensesResult[0]?.total ??
                0,
            );

          const bankDeposits =
            Number(
              bankResult[0]?.deposits ?? 0,
            );

          const bankWithdrawals =
            Number(
              bankResult[0]?.withdrawals ?? 0,
            );

          const expectedCash =
            Math.round(
              (
                openingCash +
                cashSales -
                expenseTotal -
                bankDeposits +
                bankWithdrawals
              ) *
                100,
            ) /
            100;

          const difference =
            Math.round(
              (
                closingCash -
                expectedCash
              ) *
                100,
            ) /
            100;

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
          /* AUDIT                                                             */
          /* ---------------------------------------------------------------- */

          await tx.insert(
            auditLogs,
          ).values({
            userId:
              user.id,

            action:
              "shift_closed",

            entityType:
              "shift",

            entityId:
              row.id,

            details: {
              openingCash,
              cashSales:
                Math.round(
                  cashSales * 100,
                ) / 100,
              expenses:
                Math.round(
                  expenseTotal * 100,
                ) / 100,
              bankDeposits:
                Math.round(
                  bankDeposits * 100,
                ) / 100,
              bankWithdrawals:
                Math.round(
                  bankWithdrawals * 100,
                ) / 100,
              expectedCash,
              closingCash:
                Math.round(
                  closingCash * 100,
                ) / 100,
              difference,
            },
          });

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

            expectedCash,

            difference,
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

        expectedCash:
          result.expectedCash,

        difference:
          result.difference,
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