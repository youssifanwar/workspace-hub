import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  desks,
  meetingRoomPricing,
} from "@/db/schema";

import {
  getCurrentUser,
  canManage,
} from "@/lib/auth";

type PricingTierInput = {
  id?: unknown;
  minPeople?: unknown;
  maxPeople?: unknown;
  hourlyRate?: unknown;
  active?: unknown;
};

type Body = {
  name?: unknown;
  active?: unknown;
  hourlyRate?: unknown;
  capacity?: unknown;
  sortOrder?: unknown;

  /**
   * Meeting-room pricing is submitted together with the room update.
   *
   * This allows room settings + pricing to be committed atomically
   * inside the same database transaction.
   */
  meetingPricing?: PricingTierInput[];
};

/* ============================================================================
 * HELPERS
 * ========================================================================== */

function numberOrNull(
  value: unknown,
): number | null {
  const n =
    typeof value === "number"
      ? value
      : Number(value);

  return Number.isFinite(n)
    ? n
    : null;
}

function positiveInteger(
  value: unknown,
): number | null {
  const n =
    numberOrNull(value);

  if (
    n === null ||
    !Number.isInteger(n) ||
    n <= 0
  ) {
    return null;
  }

  return n;
}

function nonNegativeInteger(
  value: unknown,
): number | null {
  const n =
    numberOrNull(value);

  if (
    n === null ||
    !Number.isInteger(n) ||
    n < 0
  ) {
    return null;
  }

  return n;
}

function positiveMoney(
  value: unknown,
): number | null {
  const n =
    numberOrNull(value);

  if (
    n === null ||
    n <= 0
  ) {
    return null;
  }

  return n;
}

function parseBoolean(
  value: unknown,
  defaultValue: boolean,
): boolean {
  if (
    typeof value === "boolean"
  ) {
    return value;
  }

  if (
    typeof value === "string"
  ) {
    const normalized =
      value.trim().toLowerCase();

    if (
      normalized === "true"
    ) {
      return true;
    }

    if (
      normalized === "false"
    ) {
      return false;
    }
  }

  return defaultValue;
}

/* ============================================================================
 * MEETING ROOM PRICING VALIDATION
 * ========================================================================== */

function normalizeMeetingRoomPricing(
  capacity: number,
  tiers: PricingTierInput[],
): Array<{
  minPeople: number;
  maxPeople: number;
  hourlyRate: number;
}> {
  if (
    !Number.isInteger(
      capacity,
    ) ||
    capacity <= 0 ||
    capacity > 100
  ) {
    throw new Error(
      "Meeting room capacity must be a whole number between 1 and 100.",
    );
  }

  if (
    !Array.isArray(tiers) ||
    tiers.length === 0
  ) {
    throw new Error(
      "A meeting room must have at least one pricing tier.",
    );
  }

  const normalized =
    tiers
      .map(
        (tier) => {
          const minPeople =
            positiveInteger(
              tier.minPeople,
            );

          const maxPeople =
            positiveInteger(
              tier.maxPeople,
            );

          const hourlyRate =
            positiveMoney(
              tier.hourlyRate,
            );

          const active =
            parseBoolean(
              tier.active,
              true,
            );

          if (
            minPeople === null ||
            maxPeople === null
          ) {
            throw new Error(
              "Meeting room pricing ranges must use positive whole numbers.",
            );
          }

          if (
            maxPeople <
            minPeople
          ) {
            throw new Error(
              "Invalid meeting room pricing range.",
            );
          }

          if (
            hourlyRate === null
          ) {
            throw new Error(
              "Every meeting room pricing tier must have a rate greater than zero.",
            );
          }

          return {
            minPeople,
            maxPeople,
            hourlyRate,
            active,
          };
        },
      )
      .filter(
        (tier) =>
          tier.active,
      )
      .sort(
        (a, b) =>
          a.minPeople -
          b.minPeople,
      );

  if (
    normalized.length === 0
  ) {
    throw new Error(
      "At least one active meeting room pricing tier is required.",
    );
  }

  let expectedMin =
    1;

  for (
    const tier of normalized
  ) {
    if (
      tier.minPeople !==
      expectedMin
    ) {
      throw new Error(
        "Meeting room pricing tiers must cover every attendee count without gaps or overlaps.",
      );
    }

    if (
      tier.maxPeople >
      capacity
    ) {
      throw new Error(
        `Meeting room pricing cannot exceed the room capacity of ${capacity}.`,
      );
    }

    expectedMin =
      tier.maxPeople + 1;
  }

  if (
    expectedMin !==
    capacity + 1
  ) {
    throw new Error(
      `Meeting room pricing tiers must cover all people from 1 to ${capacity}.`,
    );
  }

  return normalized.map(
    (tier) => ({
      minPeople:
        tier.minPeople,
      maxPeople:
        tier.maxPeople,
      hourlyRate:
        tier.hourlyRate,
    }),
  );
}

/* ============================================================================
 * PATCH LOCATION
 * ========================================================================== */

export async function PATCH(
  req: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
    }>;
  },
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

    if (
      !canManage(
        user.role,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Forbidden",
        },
        {
          status: 403,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * PARAMS
     * ---------------------------------------------------------------------- */

    const {
      id,
    } = await params;

    const deskId =
      Number(id);

    if (
      !Number.isInteger(
        deskId,
      ) ||
      deskId <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid location ID.",
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * BODY
     * ---------------------------------------------------------------------- */

    const body =
      (await req
        .json()
        .catch(
          () => null,
        )) as Body | null;

    if (
      !body ||
      typeof body !==
        "object"
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

    /* ------------------------------------------------------------------------
     * TRANSACTION
     *
     * Room data and its pricing are deliberately updated in the SAME
     * transaction.
     *
     * That means there cannot be a committed state such as:
     *
     * room updated ✅
     * pricing failed ❌
     *
     * Either everything commits or everything rolls back.
     * ---------------------------------------------------------------------- */

    const result =
      await db.transaction(
        async (tx) => {
          /* ------------------------------------------------------------------
           * LOAD CURRENT LOCATION
           * ---------------------------------------------------------------- */

          const [
            current,
          ] =
            await tx
              .select({
                id:
                  desks.id,

                name:
                  desks.name,

                type:
                  desks.type,

                capacity:
                  desks.capacity,

                active:
                  desks.active,

                hourlyRate:
                  desks.hourlyRate,

                sortOrder:
                  desks.sortOrder,
              })
              .from(
                desks,
              )
              .where(
                eq(
                  desks.id,
                  deskId,
                ),
              )
              .limit(1);

          if (!current) {
            return {
              error:
                "Location not found.",
              status: 404,
            } as const;
          }

          /* ------------------------------------------------------------------
           * BUILD DESK UPDATE
           * ---------------------------------------------------------------- */

          const update: {
            name?: string;
            active?: boolean;
            hourlyRate?: string;
            capacity?: number;
            sortOrder?: number;
          } = {};

          /* ------------------------------------------------------------------
           * NAME
           * ---------------------------------------------------------------- */

          if (
            typeof body.name ===
            "string"
          ) {
            const name =
              body.name.trim();

            if (!name) {
              return {
                error:
                  "Name cannot be empty.",
                status: 400,
              } as const;
            }

            if (
              name.length >
              100
            ) {
              return {
                error:
                  "Name is too long.",
                status: 400,
              } as const;
            }

            update.name =
              name;
          }

          /* ------------------------------------------------------------------
           * ACTIVE
           * ---------------------------------------------------------------- */

          if (
            typeof body.active ===
            "boolean"
          ) {
            update.active =
              body.active;
          }

          /* ------------------------------------------------------------------
           * SORT ORDER
           * ---------------------------------------------------------------- */

          if (
            body.sortOrder !==
            undefined
          ) {
            const sortOrder =
              nonNegativeInteger(
                body.sortOrder,
              );

            if (
              sortOrder ===
              null
            ) {
              return {
                error:
                  "Sort order must be a whole number greater than or equal to zero.",
                status: 400,
              } as const;
            }

            update.sortOrder =
              sortOrder;
          }

          /* ------------------------------------------------------------------
           * NORMAL DESK
           * ---------------------------------------------------------------- */

          if (
            current.type ===
            "desk"
          ) {
            if (
              body.hourlyRate !==
              undefined
            ) {
              const rate =
                positiveMoney(
                  body.hourlyRate,
                );

              if (
                rate ===
                null
              ) {
                return {
                  error:
                    "Desk hourly rate must be greater than zero.",
                  status: 400,
                } as const;
              }

              update.hourlyRate =
                rate.toFixed(
                  2,
                );
            }

            /*
             * Normal desks always keep capacity = 1.
             *
             * We deliberately ignore an accidental capacity field here
             * instead of turning a normal desk into a multi-seat resource.
             */
            if (
              body.capacity !==
                undefined &&
              positiveInteger(
                body.capacity,
              ) !== 1
            ) {
              return {
                error:
                  "A normal desk must have capacity 1.",
                status: 400,
              } as const;
            }
          }

          /* ------------------------------------------------------------------
           * MEETING ROOM
           * ---------------------------------------------------------------- */

          if (
            current.type ===
            "meeting_room"
          ) {
            const requestedCapacity =
              body.capacity ===
              undefined
                ? current.capacity
                : positiveInteger(
                    body.capacity,
                  );

            if (
              requestedCapacity ===
                null ||
              requestedCapacity >
                100
            ) {
              return {
                error:
                  "Meeting room capacity must be a whole number between 1 and 100.",
                status: 400,
              } as const;
            }

            update.capacity =
              requestedCapacity;

            /*
             * Pricing is optional only when the room capacity itself did not
             * change and the caller is not attempting to replace pricing.
             *
             * The frontend will send pricing whenever room editing is done,
             * which gives us a single atomic request.
             */
            const pricingWasSupplied =
              body.meetingPricing !==
              undefined;

            const capacityChanged =
              requestedCapacity !==
              current.capacity;

            if (
              capacityChanged &&
              !pricingWasSupplied
            ) {
              return {
                error:
                  "Provide the complete meeting-room pricing tiers when changing capacity.",
                status: 400,
              } as const;
            }

            /* ---------------------------------------------------------------
             * PRICE UPDATE
             * ------------------------------------------------------------- */

            if (
              pricingWasSupplied
            ) {
              let normalizedTiers:
                Array<{
                  minPeople: number;
                  maxPeople: number;
                  hourlyRate: number;
                }>;

              try {
                normalizedTiers =
                  normalizeMeetingRoomPricing(
                    requestedCapacity,
                    body.meetingPricing!,
                  );
              } catch (
                error
              ) {
                return {
                  error:
                    error instanceof
                    Error
                      ? error.message
                      : "Invalid meeting room pricing.",
                  status: 400,
                } as const;
              }

              /*
               * Meeting room pricing is completely authoritative for the
               * room. Replace the complete set in the same transaction.
               *
               * Old pricing rows disappear only when the new pricing rows are
               * successfully inserted. Any insertion error rolls the whole
               * transaction back, including this delete.
               */

              await tx
                .delete(
                  meetingRoomPricing,
                )
                .where(
                  eq(
                    meetingRoomPricing.deskId,
                    deskId,
                  ),
                );

              await tx
                .insert(
                  meetingRoomPricing,
                )
                .values(
                  normalizedTiers.map(
                    (
                      tier,
                    ) => ({
                      deskId,

                      minPeople:
                        tier.minPeople,

                      maxPeople:
                        tier.maxPeople,

                      hourlyRate:
                        tier.hourlyRate.toFixed(
                          2,
                        ),

                      active:
                        true,
                    }),
                  ),
                );

              /*
               * This field is only a legacy physical-location rate.
               * Meeting-room billing must come from meetingRoomPricing.
               */
              update.hourlyRate =
                "0.00";
            }
          }

          /* ------------------------------------------------------------------
           * NO CHANGES
           * ---------------------------------------------------------------- */

          if (
            Object.keys(
              update,
            ).length === 0
          ) {
            return {
              error:
                "No changes.",
              status: 400,
            } as const;
          }

          /* ------------------------------------------------------------------
           * UPDATE LOCATION
           * ---------------------------------------------------------------- */

          const [
            updated,
          ] =
            await tx
              .update(
                desks,
              )
              .set(
                update,
              )
              .where(
                eq(
                  desks.id,
                  deskId,
                ),
              )
              .returning({
                id:
                  desks.id,

                name:
                  desks.name,

                type:
                  desks.type,

                hourlyRate:
                  desks.hourlyRate,

                capacity:
                  desks.capacity,

                active:
                  desks.active,

                sortOrder:
                  desks.sortOrder,
              });

          if (!updated) {
            throw new Error(
              "Could not update the location.",
            );
          }

          /* ------------------------------------------------------------------
           * RETURN
           * ---------------------------------------------------------------- */

          return {
            ok: true,
            desk:
              updated,
          } as const;
        },
      );

    /* ------------------------------------------------------------------------
     * ERROR RESPONSE FROM TRANSACTION
     * ---------------------------------------------------------------------- */

    if (
      "error" in result
    ) {
      return NextResponse.json(
        {
          error:
            result.error,
        },
        {
          status:
            result.status,
        },
      );
    }

    return NextResponse.json(
      result,
    );
  } catch (error) {
    console.error(
      "Update location error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Could not update the location.";

    return NextResponse.json(
      {
        error:
          message,
      },
      {
        status: 500,
      },
    );
  }
}

/* ============================================================================
 * DELETE / DEACTIVATE LOCATION
 *
 * We preserve the row instead of physically deleting it.
 * Existing reservations/history therefore keep their foreign-key target.
 * ========================================================================== */

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

    if (
      !canManage(
        user.role,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Forbidden",
        },
        {
          status: 403,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * PARAMS
     * ---------------------------------------------------------------------- */

    const {
      id,
    } = await params;

    const deskId =
      Number(id);

    if (
      !Number.isInteger(
        deskId,
      ) ||
      deskId <= 0
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid location ID.",
        },
        {
          status: 400,
        },
      );
    }

    /* ------------------------------------------------------------------------
     * DEACTIVATE
     * ---------------------------------------------------------------------- */

    const [
      updated,
    ] =
      await db
        .update(
          desks,
        )
        .set({
          active:
            false,
        })
        .where(
          eq(
            desks.id,
            deskId,
          ),
        )
        .returning({
          id:
            desks.id,
          active:
            desks.active,
        });

    if (!updated) {
      return NextResponse.json(
        {
          error:
            "Location not found.",
        },
        {
          status: 404,
        },
      );
    }

    return NextResponse.json({
      ok: true,
      desk:
        updated,
    });
  } catch (error) {
    console.error(
      "Deactivate location error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not deactivate the location.",
      },
      {
        status: 500,
      },
    );
  }
}