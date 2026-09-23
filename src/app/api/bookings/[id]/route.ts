import { NextResponse } from "next/server";

import { db } from "@/db";

import {
  bookings,
  subscriptionUsageLedger,
} from "@/db/schema";

import {
  and,
  eq,
  sql,
} from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";

export async function DELETE(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
) {
  try {
    const { id } =
      await params;

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

    const activeShift =
      await getActiveShiftForUser(
        user.id,
      );

    if (!activeShift) {
      return NextResponse.json(
        {
          error:
            "No active shift",
        },
        {
          status: 400,
        },
      );
    }

    const bookingId =
      Number(id);

    if (
      !Number.isInteger(
        bookingId,
      ) ||
      bookingId <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid booking id",
        },
        {
          status: 400,
        },
      );
    }

    const result =
      await db.transaction(
        async (
          tx,
        ) => {
          /*
           * Serialize all operations against the same booking.
           *
           * This protects against two DELETE requests arriving at
           * nearly the same time.
           */
          await tx.execute(
            sql`
              SELECT pg_advisory_xact_lock(
                29004,
                ${bookingId}
              )
            `,
          );

          const [
            booking,
          ] =
            await tx
              .select({
                id:
                  bookings.id,

                status:
                  bookings.status,

                billingMode:
                  bookings.billingMode,

                subscriptionId:
                  bookings.subscriptionId,

                subscriptionHoursUsed:
                  bookings.subscriptionHoursUsed,

                shiftId:
                  bookings.shiftId,
              })
              .from(
                bookings,
              )
              .where(
                eq(
                  bookings.id,
                  bookingId,
                ),
              )
              .limit(1);

          /*
           * DELETE is intentionally idempotent.
           *
           * If the booking has already been removed by a previous
           * successful cancellation, report success rather than
           * making the UI think the operation failed.
           */
          if (!booking) {
            return {
              alreadyCancelled:
                true,

              bookingId,
            };
          }

          /*
           * A closed session is historical/final and must not be
           * deleted through the cancellation endpoint.
           */
          if (
            booking.status ===
            "closed"
          ) {
            return {
              error:
                "Session already closed",
            };
          }

          if (booking.shiftId !== activeShift.id) {
            throw new CancellationError(
              "This session does not belong to your active shift",
              403,
            );
          }

          /*
           * Package usage normally happens during checkout.
           *
           * For an active package session there normally is no usage
           * to reverse yet. Still, we defensively check for an existing
           * usage ledger entry so a partial/retried operation cannot
           * leave package hours permanently consumed.
           */
          if (
            booking.billingMode ===
              "package" &&
            booking.subscriptionId
          ) {
            await tx.execute(
              sql`
                SELECT pg_advisory_xact_lock(
                  29002,
                  ${booking.subscriptionId}
                )
              `,
            );

            const usageKey =
              `booking-checkout:${bookingId}`;

            const [
              usageEntry,
            ] =
              await tx
                .select({
                  id:
                    subscriptionUsageLedger.id,

                  hoursDelta:
                    subscriptionUsageLedger.hoursDelta,
                })
                .from(
                  subscriptionUsageLedger,
                )
                .where(
                  and(
                    eq(
                      subscriptionUsageLedger.subscriptionId,
                      booking.subscriptionId,
                    ),
                    eq(
                      subscriptionUsageLedger.idempotencyKey,
                      usageKey,
                    ),
                  ),
                )
                .limit(1);

            if (
              usageEntry
            ) {
              const alreadyReversedKey =
                `booking-cancel-reversal:${bookingId}`;

              const [
                existingReversal,
              ] =
                await tx
                  .select({
                    id:
                      subscriptionUsageLedger.id,
                  })
                  .from(
                    subscriptionUsageLedger,
                  )
                  .where(
                    eq(
                      subscriptionUsageLedger.idempotencyKey,
                      alreadyReversedKey,
                    ),
                  )
                  .limit(1);

              if (
                !existingReversal
              ) {
                const usedHours =
                  Math.abs(
                    Number(
                      usageEntry.hoursDelta,
                    ),
                  );

                if (
                  Number.isFinite(
                    usedHours,
                  ) &&
                  usedHours >
                    0
                ) {
                  await tx
                    .insert(
                      subscriptionUsageLedger,
                    )
                    .values({
                      subscriptionId:
                        booking.subscriptionId,

                      bookingId:
                        bookingId,

                      userId:
                        user.id,

                      entryType:
                        "reversal",

                      hoursDelta:
                        usedHours.toFixed(
                          2,
                        ),

                      reason:
                        `Cancelled Customer Session #${bookingId}`,

                      idempotencyKey:
                        alreadyReversedKey,
                    });
                }
              }
            }
          }

          /*
           * Delete only an ACTIVE session.
           *
           * This condition is intentionally repeated at SQL level,
           * not only checked in application code.
           */
          const deleted =
            await tx
              .delete(
                bookings,
              )
              .where(
                and(
                  eq(
                    bookings.id,
                    bookingId,
                  ),
                  eq(
                    bookings.status,
                    "active",
                  ),
                ),
              )
              .returning({
                id:
                  bookings.id,
              });

          /*
           * The booking may have been changed between the read and
           * delete only if another code path bypassed our lock.
           * Treat that as a conflict instead of returning false success.
           */
          if (
            deleted.length ===
            0
          ) {
            throw new CancellationError(
              "Session could not be cancelled. It may have already been closed or cancelled.",
              409,
            );
          }

          return {
            alreadyCancelled:
              false,

            bookingId,
          };
        },
      );

    if (
      "error" in result
    ) {
      return NextResponse.json(
        {
          error:
            result.error,
        },
        {
          status: 400,
        },
      );
    }

    return NextResponse.json({
      ok: true,

      sessionId:
        result.bookingId,

      alreadyCancelled:
        result.alreadyCancelled,
    });
  } catch (error) {
    if (
      error instanceof
      CancellationError
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

    console.error(
      "[booking DELETE] failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to cancel session. Please try again.",
      },
      {
        status: 500,
      },
    );
  }
}

class CancellationError extends Error {
  status: number;

  constructor(
    message: string,
    status: number,
  ) {
    super(message);

    this.name =
      "CancellationError";

    this.status =
      status;
  }
}