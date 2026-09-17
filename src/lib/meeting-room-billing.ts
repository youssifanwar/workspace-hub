import {
  and,
  eq,
} from "drizzle-orm";

import { db } from "@/db";
import {
  desks,
  meetingRoomPricing,
  meetingRoomPackages,
  customerMeetingRoomPackages,
  meetingRoomPackageUsageLedger,
} from "@/db/schema";

/**
 * ============================================================================
 * Meeting Room Billing
 * ============================================================================
 *
 * Single source of truth for meeting-room pricing.
 *
 * Business rules:
 *
 * 1. Price depends on:
 *    - meeting room
 *    - attendee count
 *    - booking duration
 *
 * 2. Meeting-room packages:
 *    - 10 hours  -> 8% discount
 *    - 20 hours  -> 12% discount
 *    - 40 hours  -> 18% discount
 *
 * 3. A booking cannot use 1.5 hours.
 *
 * 4. Historical bookings must keep the rate that was active at booking time.
 *
 * 5. Package balance must never become negative.
 *
 * 6. Financial calculations use integer cents internally to avoid floating
 *    point problems.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type MeetingRoomPricingTier = {
  id: number;
  deskId: number;
  minPeople: number;
  maxPeople: number;
  hourlyRate: string;
  active: boolean;
};

export type MeetingRoomPackageDefinition = {
  id: number;
  name: string;
  totalHours: string;
  discountPercent: string;
  price: string;
  validityDays: number | null;
  description: string | null;
  status: "active" | "inactive";
};

export type MeetingRoomBillingInput = {
  deskId: number;
  attendeeCount: number;
  durationHours: number;
};

export type MeetingRoomBillingResult = {
  deskId: number;
  attendeeCount: number;

  durationHours: number;

  minPeople: number;
  maxPeople: number;

  hourlyRate: string;

  subtotalAmount: string;

  packageDiscountPercent: string;
  packageDiscountAmount: string;

  totalAmount: string;
};

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const MONEY_SCALE = 100;

const ZERO = 0;

const ALLOWED_PACKAGE_HOURS = new Map<number, number>([
  [10, 8],
  [20, 12],
  [40, 18],
]);

/* -------------------------------------------------------------------------- */
/* Generic numeric helpers                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Convert a decimal money string/number to integer cents.
 *
 * Example:
 * "120.50" -> 12050
 */
function toCents(value: string | number): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(
      "Invalid monetary value.",
    );
  }

  return Math.round(
    parsed * MONEY_SCALE,
  );
}

/**
 * Convert cents back to a database-safe decimal string.
 *
 * Example:
 * 12050 -> "120.50"
 */
function fromCents(
  cents: number,
): string {
  if (!Number.isFinite(cents)) {
    throw new Error(
      "Invalid cents value.",
    );
  }

  return (
    (cents / MONEY_SCALE).toFixed(2)
  );
}

/**
 * Parse a positive number safely.
 */
function parsePositiveNumber(
  value: string | number,
  fieldName: string,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(value);

  if (
    !Number.isFinite(parsed) ||
    parsed <= ZERO
  ) {
    throw new Error(
      `${fieldName} must be greater than zero.`,
    );
  }

  return parsed;
}

/**
 * Parse a positive integer safely.
 */
function parsePositiveInteger(
  value: unknown,
  fieldName: string,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number(
          String(value),
        );

  if (
    !Number.isInteger(parsed) ||
    parsed <= ZERO
  ) {
    throw new Error(
      `${fieldName} must be a positive integer.`,
    );
  }

  return parsed;
}

/* -------------------------------------------------------------------------- */
/* Duration validation                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Meeting room bookings must use whole hours.
 *
 * Examples:
 * 1      -> valid
 * 2      -> valid
 * 3      -> valid
 *
 * 1.5    -> invalid
 * 2.5    -> invalid
 * 0.5    -> invalid
 */
export function validateMeetingRoomDuration(
  durationHours: number,
): number {
  const duration =
    parsePositiveNumber(
      durationHours,
      "durationHours",
    );

  if (
    !Number.isInteger(
      duration,
    )
  ) {
    throw new Error(
      "Meeting room duration must be a whole number of hours. 1:30 hour bookings are not allowed.",
    );
  }

  return duration;
}

/* -------------------------------------------------------------------------- */
/* Attendee validation                                                        */
/* -------------------------------------------------------------------------- */

export function validateAttendeeCount(
  attendeeCount: number,
  capacity: number,
): number {
  const people =
    parsePositiveInteger(
      attendeeCount,
      "attendeeCount",
    );

  const roomCapacity =
    parsePositiveInteger(
      capacity,
      "capacity",
    );

  if (people > roomCapacity) {
    throw new Error(
      `The meeting room capacity is ${roomCapacity} people.`,
    );
  }

  return people;
}

/* -------------------------------------------------------------------------- */
/* Room helpers                                                               */
/* -------------------------------------------------------------------------- */

export async function getMeetingRoom(
  deskId: number,
) {
  const id =
    parsePositiveInteger(
      deskId,
      "deskId",
    );

  const result =
    await db
      .select({
        id: desks.id,
        name: desks.name,
        type: desks.type,
        capacity: desks.capacity,
        hourlyRate: desks.hourlyRate,
        active: desks.active,
      })
      .from(desks)
      .where(
        eq(
          desks.id,
          id,
        ),
      )
      .limit(1);

  const room =
    result[0];

  if (!room) {
    throw new Error(
      "Meeting room not found.",
    );
  }

  if (
    room.type !==
    "meeting_room"
  ) {
    throw new Error(
      "Selected location is not a meeting room.",
    );
  }

  if (!room.active) {
    throw new Error(
      "This meeting room is inactive.",
    );
  }

  return room;
}

/* -------------------------------------------------------------------------- */
/* Pricing tier                                                               */
/* -------------------------------------------------------------------------- */

export async function getMeetingRoomPricingTier(
  deskId: number,
  attendeeCount: number,
): Promise<MeetingRoomPricingTier> {
  const room =
    await getMeetingRoom(
      deskId,
    );

  const people =
    validateAttendeeCount(
      attendeeCount,
      room.capacity,
    );

  const rows =
    await db
      .select({
        id:
          meetingRoomPricing.id,
        deskId:
          meetingRoomPricing.deskId,
        minPeople:
          meetingRoomPricing.minPeople,
        maxPeople:
          meetingRoomPricing.maxPeople,
        hourlyRate:
          meetingRoomPricing.hourlyRate,
        active:
          meetingRoomPricing.active,
      })
      .from(
        meetingRoomPricing,
      )
      .where(
        and(
          eq(
            meetingRoomPricing.deskId,
            room.id,
          ),
          eq(
            meetingRoomPricing.active,
            true,
          ),
        ),
      );

  const matchingTiers =
    rows.filter(
      (tier) =>
        people >=
          tier.minPeople &&
        people <=
          tier.maxPeople,
    );

  if (
    matchingTiers.length === 0
  ) {
    throw new Error(
      `No active pricing tier exists for ${people} people in ${room.name}.`,
    );
  }

  if (
    matchingTiers.length > 1
  ) {
    throw new Error(
      `More than one pricing tier matches ${people} people for ${room.name}. Please fix the room pricing configuration.`,
    );
  }

  const tier =
    matchingTiers[0];

  if (
    tier.minPeople <= ZERO ||
    tier.maxPeople <
      tier.minPeople
  ) {
    throw new Error(
      "Invalid meeting room pricing range configuration.",
    );
  }

  const hourlyRate =
    Number.parseFloat(
      tier.hourlyRate,
    );

  if (
    !Number.isFinite(
      hourlyRate,
    ) ||
    hourlyRate < ZERO
  ) {
    throw new Error(
      `Invalid hourly rate configured for ${room.name}.`,
    );
  }

  return tier;
}

/* -------------------------------------------------------------------------- */
/* Package discount                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Return the business discount assigned to a package size.
 *
 * 10 -> 8
 * 20 -> 12
 * 40 -> 18
 */
export function getMeetingRoomPackageDiscountPercent(
  totalHours: string | number,
): number {
  const hours =
    parsePositiveNumber(
      totalHours,
      "totalHours",
    );

  const discount =
    ALLOWED_PACKAGE_HOURS.get(
      hours,
    );

  if (
    discount === undefined
  ) {
    throw new Error(
      "Meeting room packages must be 10, 20, or 40 hours.",
    );
  }

  return discount;
}

/**
 * Validate package definition.
 *
 * This should be called whenever an admin creates/updates a package.
 */
export function validateMeetingRoomPackageDefinition(
  input: {
    totalHours: string | number;
    discountPercent: string | number;
    price: string | number;
  },
) {
  const totalHours =
    parsePositiveNumber(
      input.totalHours,
      "totalHours",
    );

  if (
    !ALLOWED_PACKAGE_HOURS.has(
      totalHours,
    )
  ) {
    throw new Error(
      "Meeting room packages must be 10, 20, or 40 hours.",
    );
  }

  const expectedDiscount =
    getMeetingRoomPackageDiscountPercent(
      totalHours,
    );

  const providedDiscount =
    Number.parseFloat(
      String(
        input.discountPercent,
      ),
    );

  if (
    !Number.isFinite(
      providedDiscount,
    )
  ) {
    throw new Error(
      "Invalid package discount.",
    );
  }

  if (
    providedDiscount !==
    expectedDiscount
  ) {
    throw new Error(
      `A ${totalHours}-hour package must use a ${expectedDiscount}% discount.`,
    );
  }

  const price =
    toCents(
      input.price,
    );

  if (
    price <= ZERO
  ) {
    throw new Error(
      "Meeting room package price must be greater than zero.",
    );
  }

  return {
    totalHours,
    discountPercent:
      expectedDiscount,
    price: fromCents(price),
  };
}

/* -------------------------------------------------------------------------- */
/* Basic room booking calculation                                             */
/* -------------------------------------------------------------------------- */

export async function calculateMeetingRoomBooking(
  input: MeetingRoomBillingInput,
): Promise<MeetingRoomBillingResult> {
  const room =
    await getMeetingRoom(
      input.deskId,
    );

  const durationHours =
    validateMeetingRoomDuration(
      input.durationHours,
    );

  const attendeeCount =
    validateAttendeeCount(
      input.attendeeCount,
      room.capacity,
    );

  const pricingTier =
    await getMeetingRoomPricingTier(
      room.id,
      attendeeCount,
    );

  const hourlyRateCents =
    toCents(
      pricingTier.hourlyRate,
    );

  const subtotalCents =
    hourlyRateCents *
    durationHours;

  return {
    deskId: room.id,

    attendeeCount,

    durationHours,

    minPeople:
      pricingTier.minPeople,

    maxPeople:
      pricingTier.maxPeople,

    hourlyRate:
      fromCents(
        hourlyRateCents,
      ),

    subtotalAmount:
      fromCents(
        subtotalCents,
      ),

    packageDiscountPercent:
      "0.00",

    packageDiscountAmount:
      "0.00",

    totalAmount:
      fromCents(
        subtotalCents,
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Package calculation                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Calculate a booking when the customer uses a meeting-room package.
 *
 * IMPORTANT:
 *
 * The package gives a percentage discount on the calculated room price.
 *
 * Package hours are consumed from the package balance.
 */
export async function calculateMeetingRoomBookingWithPackage(
  input: MeetingRoomBillingInput & {
    packagePurchaseId: number;
  },
): Promise<
  MeetingRoomBillingResult & {
    packagePurchaseId: number;
    packageRemainingHours: string;
    packageHoursUsed: string;
  }
> {
  const base =
    await calculateMeetingRoomBooking(
      input,
    );

  const packagePurchaseId =
    parsePositiveInteger(
      input.packagePurchaseId,
      "packagePurchaseId",
    );

  const packageRows =
    await db
      .select({
        id:
          customerMeetingRoomPackages.id,
        totalHoursSnapshot:
          customerMeetingRoomPackages.totalHoursSnapshot,
        discountPercentSnapshot:
          customerMeetingRoomPackages.discountPercentSnapshot,
        status:
          customerMeetingRoomPackages.status,
        expiresAt:
          customerMeetingRoomPackages.expiresAt,
      })
      .from(
        customerMeetingRoomPackages,
      )
      .where(
        eq(
          customerMeetingRoomPackages.id,
          packagePurchaseId,
        ),
      )
      .limit(1);

  const purchase =
    packageRows[0];

  if (!purchase) {
    throw new Error(
      "Meeting room package purchase not found.",
    );
  }

  if (
    purchase.status !==
    "active"
  ) {
    throw new Error(
      "This meeting room package is not active.",
    );
  }

  if (
    purchase.expiresAt &&
    purchase.expiresAt.getTime() <=
      Date.now()
  ) {
    throw new Error(
      "This meeting room package has expired.",
    );
  }

  const packageHours =
    parsePositiveNumber(
      purchase.totalHoursSnapshot,
      "package total hours",
    );

  const discountPercent =
    Number.parseFloat(
      purchase.discountPercentSnapshot,
    );

  if (
    !Number.isFinite(
      discountPercent,
    ) ||
    discountPercent < ZERO ||
    discountPercent > 100
  ) {
    throw new Error(
      "Invalid meeting room package discount configuration.",
    );
  }

  const expectedDiscount =
    getMeetingRoomPackageDiscountPercent(
      packageHours,
    );

  if (
    discountPercent !==
    expectedDiscount
  ) {
    throw new Error(
      "Meeting room package discount configuration is invalid.",
    );
  }

  const packageHoursUsed =
    base.durationHours;

  const usageRows =
    await db
      .select({
        hoursDelta:
          meetingRoomPackageUsageLedger.hoursDelta,
      })
      .from(
        meetingRoomPackageUsageLedger,
      )
      .where(
        eq(
          meetingRoomPackageUsageLedger.packagePurchaseId,
          packagePurchaseId,
        ),
      );

  let balance =
    0;

  for (
    const row of usageRows
  ) {
    const delta =
      Number.parseFloat(
        row.hoursDelta,
      );

    if (
      Number.isFinite(
        delta,
      )
    ) {
      balance += delta;
    }
  }

  balance =
    Math.round(
      balance * 100,
    ) / 100;

  if (
    balance <
    packageHoursUsed
  ) {
    throw new Error(
      `Insufficient meeting room package balance. Remaining: ${balance} hours.`,
    );
  }

  const subtotalCents =
    toCents(
      base.subtotalAmount,
    );

  const discountCents =
    Math.round(
      subtotalCents *
        (discountPercent /
          100),
    );

  const totalCents =
    subtotalCents -
    discountCents;

  const remainingHours =
    Math.round(
      (balance -
        packageHoursUsed) *
        100,
    ) / 100;

  return {
    ...base,

    packagePurchaseId,

    packageDiscountPercent:
      discountPercent.toFixed(
        2,
      ),

    packageDiscountAmount:
      fromCents(
        discountCents,
      ),

    totalAmount:
      fromCents(
        totalCents,
      ),

    packageRemainingHours:
      remainingHours.toFixed(
        2,
      ),

    packageHoursUsed:
      packageHoursUsed.toFixed(
        2,
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Fixed business configuration                                               */
/* -------------------------------------------------------------------------- */

/**
 * These are the exact package rules agreed for the business.
 *
 * 10h = 8%
 * 20h = 12%
 * 40h = 18%
 */
export function getDefaultMeetingRoomPackageRules() {
  return [
    {
      totalHours: 10,
      discountPercent: 8,
      name: "Meeting Room 10 Hours",
    },
    {
      totalHours: 20,
      discountPercent: 12,
      name: "Meeting Room 20 Hours",
    },
    {
      totalHours: 40,
      discountPercent: 18,
      name: "Meeting Room 40 Hours",
    },
  ] as const;
}

/* -------------------------------------------------------------------------- */
/* Seed room pricing                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Exact room pricing agreed for the three current meeting rooms.
 *
 * NOTE:
 * This function only returns configuration.
 * It does not write anything to the database.
 *
 * We keep the data here as a seed/reference helper.
 * Actual production pricing should be stored in meeting_room_pricing and
 * edited from the admin settings UI.
 */
export function getDefaultMeetingRoomPricing() {
  return {
    العربي: {
      capacity: 4,

      tiers: [
        {
          minPeople: 1,
          maxPeople: 2,
          hourlyRate: "100.00",
        },
        {
          minPeople: 3,
          maxPeople: 4,
          hourlyRate: "140.00",
        },
      ],
    },

    الفرنساوي: {
      capacity: 8,

      tiers: [
        {
          minPeople: 1,
          maxPeople: 2,
          hourlyRate: "120.00",
        },
        {
          minPeople: 3,
          maxPeople: 4,
          hourlyRate: "150.00",
        },
        {
          minPeople: 5,
          maxPeople: 6,
          hourlyRate: "180.00",
        },
        {
          minPeople: 7,
          maxPeople: 8,
          hourlyRate: "210.00",
        },
      ],
    },

    مغربي: {
      capacity: 8,

      tiers: [
        {
          minPeople: 1,
          maxPeople: 2,
          hourlyRate: "140.00",
        },
        {
          minPeople: 3,
          maxPeople: 4,
          hourlyRate: "170.00",
        },
        {
          minPeople: 5,
          maxPeople: 6,
          hourlyRate: "200.00",
        },
        {
          minPeople: 7,
          maxPeople: 8,
          hourlyRate: "230.00",
        },
      ],
    },
  } as const;
}

/* -------------------------------------------------------------------------- */
/* Price tier validation                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Validate a whole room pricing configuration.
 *
 * This catches overlapping ranges and invalid gaps before they reach
 * production.
 */
export function validatePricingTiers(
  tiers: Array<{
    minPeople: number;
    maxPeople: number;
    hourlyRate: string | number;
  }>,
  capacity: number,
) {
  const roomCapacity =
    parsePositiveInteger(
      capacity,
      "capacity",
    );

  if (
    tiers.length === 0
  ) {
    throw new Error(
      "Meeting room must have at least one pricing tier.",
    );
  }

  const normalized =
    tiers
      .map((tier) => ({
        minPeople:
          parsePositiveInteger(
            tier.minPeople,
            "minPeople",
          ),

        maxPeople:
          parsePositiveInteger(
            tier.maxPeople,
            "maxPeople",
          ),

        hourlyRate:
          toCents(
            tier.hourlyRate,
          ),
      }))
      .sort(
        (a, b) =>
          a.minPeople -
          b.minPeople,
      );

  let expectedNextPerson =
    1;

  for (
    const tier of normalized
  ) {
    if (
      tier.minPeople >
      tier.maxPeople
    ) {
      throw new Error(
        "Pricing tier minPeople cannot be greater than maxPeople.",
      );
    }

    if (
      tier.maxPeople >
      roomCapacity
    ) {
      throw new Error(
        `Pricing tier cannot exceed room capacity of ${roomCapacity}.`,
      );
    }

    if (
      tier.minPeople !==
      expectedNextPerson
    ) {
      throw new Error(
        "Meeting room pricing tiers must cover every attendee count without gaps or overlaps.",
      );
    }

    if (
      tier.hourlyRate <=
      ZERO
    ) {
      throw new Error(
        "Meeting room hourly rate must be greater than zero.",
      );
    }

    expectedNextPerson =
      tier.maxPeople + 1;
  }

  if (
    expectedNextPerson !==
    roomCapacity + 1
  ) {
    throw new Error(
      "Meeting room pricing tiers must cover the entire room capacity.",
    );
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/* Exported constants                                                         */
/* -------------------------------------------------------------------------- */

export const MEETING_ROOM_PACKAGE_RULES =
  {
    TEN_HOURS: {
      totalHours: 10,
      discountPercent: 8,
    },

    TWENTY_HOURS: {
      totalHours: 20,
      discountPercent: 12,
    },

    FORTY_HOURS: {
      totalHours: 40,
      discountPercent: 18,
    },
  } as const;