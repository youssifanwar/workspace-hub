import { NextResponse } from "next/server";

import { db } from "@/db";

import {
  desks,
  meetingRoomPricing,
} from "@/db/schema";

import {
  getCurrentUser,
  canManage,
} from "@/lib/auth";

type DeskType =
  | "desk"
  | "meeting_room";

type PricingTierInput = {
  minPeople?: number;
  maxPeople?: number;
  hourlyRate?: number;
  active?: boolean;
};

function isFinitePositiveNumber(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0
  );
}

function isValidCapacity(
  value: unknown,
): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 100
  );
}

function normalizeMeetingPricing(
  tiers: PricingTierInput[],
  capacity: number,
) {
  if (
    !Array.isArray(tiers) ||
    tiers.length === 0
  ) {
    throw new Error(
      "Meeting room pricing tiers are required",
    );
  }

  const normalized = tiers.map(
    (tier) => {
      const minPeople =
        Number(
          tier.minPeople,
        );

      const maxPeople =
        Number(
          tier.maxPeople,
        );

      const hourlyRate =
        Number(
          tier.hourlyRate,
        );

      const active =
        tier.active !== false;

      if (!active) {
        return null;
      }

      if (
        !Number.isInteger(
          minPeople,
        ) ||
        !Number.isInteger(
          maxPeople,
        ) ||
        minPeople < 1 ||
        maxPeople < minPeople ||
        maxPeople > capacity
      ) {
        throw new Error(
          "Invalid meeting room pricing range",
        );
      }

      if (
        !isFinitePositiveNumber(
          hourlyRate,
        )
      ) {
        throw new Error(
          "Meeting room hourly rate must be greater than zero",
        );
      }

      return {
        minPeople,
        maxPeople,
        hourlyRate:
          hourlyRate.toFixed(
            2,
          ),
      };
    },
  );

  const activeTiers =
    normalized.filter(
      (
        tier,
      ): tier is {
        minPeople: number;
        maxPeople: number;
        hourlyRate: string;
      } =>
        tier !== null,
    );

  if (
    activeTiers.length === 0
  ) {
    throw new Error(
      "At least one active meeting room pricing tier is required",
    );
  }

  activeTiers.sort(
    (a, b) =>
      a.minPeople -
      b.minPeople,
  );

  let expectedMin = 1;

  for (
    const tier of activeTiers
  ) {
    if (
      tier.minPeople !==
      expectedMin
    ) {
      throw new Error(
        "Meeting room pricing tiers must cover every attendee count without gaps or overlaps",
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
      "Meeting room pricing tiers must cover every attendee count from 1 to capacity",
    );
  }

  return activeTiers;
}

export async function POST(
  req: Request,
) {
  try {
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

    let body: {
      name?: string;
      type?: DeskType;
      hourlyRate?: number;
      capacity?: number;
      sortOrder?: number;
      tiers?: PricingTierInput[];
    };

    try {
      body =
        (await req.json()) as {
          name?: string;
          type?: DeskType;
          hourlyRate?: number;
          capacity?: number;
          sortOrder?: number;
          tiers?: PricingTierInput[];
        };
    } catch {
      return NextResponse.json(
        {
          error:
            "Invalid JSON body",
        },
        {
          status: 400,
        },
      );
    }

    const name =
      body.name?.trim();

    if (!name) {
      return NextResponse.json(
        {
          error:
            "name is required",
        },
        {
          status: 400,
        },
      );
    }

    if (
      body.type !== "desk" &&
      body.type !==
        "meeting_room"
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid desk type",
        },
        {
          status: 400,
        },
      );
    }

    const type =
      body.type;

    const capacity =
      type ===
      "meeting_room"
        ? Number(
            body.capacity ??
              1,
          )
        : 1;

    if (
      !isValidCapacity(
        capacity,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid capacity",
        },
        {
          status: 400,
        },
      );
    }

    const sortOrder =
      Number(
        body.sortOrder ??
          0,
      );

    if (
      !Number.isInteger(
        sortOrder,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid sort order",
        },
        {
          status: 400,
        },
      );
    }

    let hourlyRate = 0;

    if (
      type === "desk"
    ) {
      const rate =
        Number(
          body.hourlyRate ??
            0,
        );

      if (
        !Number.isFinite(
          rate,
        ) ||
        rate < 0
      ) {
        return NextResponse.json(
          {
            error:
              "Invalid hourly rate",
          },
          {
            status: 400,
          },
        );
      }

      hourlyRate =
        rate;
    }

    let pricingTiers:
      | Array<{
          minPeople: number;
          maxPeople: number;
          hourlyRate: string;
        }>
      | null = null;

    if (
      type ===
      "meeting_room"
    ) {
      try {
        pricingTiers =
          normalizeMeetingPricing(
            body.tiers ??
              [],
            capacity,
          );
      } catch (
        error
      ) {
        return NextResponse.json(
          {
            error:
              error instanceof
              Error
                ? error.message
                : "Invalid meeting room pricing",
          },
          {
            status: 400,
          },
        );
      }

      /*
       * Meeting room prices are stored in meetingRoomPricing.
       * desks.hourlyRate is kept at zero for meeting rooms.
       */
      hourlyRate = 0;
    }

    const result =
      await db.transaction(
        async (
          tx,
        ) => {
          const [
            desk,
          ] =
            await tx
              .insert(
                desks,
              )
              .values({
                name,

                type,

                hourlyRate:
                  hourlyRate.toFixed(
                    2,
                  ),

                capacity,

                active:
                  true,

                sortOrder,
              })
              .returning();

          if (!desk) {
            throw new Error(
              "Failed to create location",
            );
          }

          if (
            type ===
              "meeting_room" &&
            pricingTiers
          ) {
            await tx
              .insert(
                meetingRoomPricing,
              )
              .values(
                pricingTiers.map(
                  (
                    tier,
                  ) => ({
                    deskId:
                      desk.id,

                    minPeople:
                      tier.minPeople,

                    maxPeople:
                      tier.maxPeople,

                    hourlyRate:
                      tier.hourlyRate,

                    active:
                      true,
                  }),
                ),
              );
          }

          return desk;
        },
      );

    return NextResponse.json(
      {
        ok: true,
        desk: result,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error(
      "[desks POST] failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to create location",
      },
      {
        status: 500,
      },
    );
  }
}