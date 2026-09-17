import { NextResponse } from "next/server";

import { db } from "@/db";
import { desks, meetingRoomPricing } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser, canManage } from "@/lib/auth";

type PricingTierInput = {
  minPeople: number;
  maxPeople: number;
  hourlyRate: number;
  active?: boolean;
};

type PutBody = {
  capacity?: number;
  tiers?: PricingTierInput[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateCapacity(value: unknown) {
  return (
    isFiniteNumber(value) &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 100
  );
}

function validateTier(
  tier: PricingTierInput,
  capacity: number,
): string | null {
  if (
    !validateCapacity(tier.minPeople) ||
    !validateCapacity(tier.maxPeople)
  ) {
    return "People range must contain whole numbers between 1 and 100.";
  }

  if (tier.minPeople > tier.maxPeople) {
    return "minPeople cannot be greater than maxPeople.";
  }

  if (tier.maxPeople > capacity) {
    return `Pricing tier cannot exceed room capacity (${capacity}).`;
  }

  if (
    !isFiniteNumber(tier.hourlyRate) ||
    tier.hourlyRate <= 0 ||
    tier.hourlyRate > 1_000_000
  ) {
    return "Hourly rate must be greater than zero.";
  }

  if (
    tier.active !== undefined &&
    typeof tier.active !== "boolean"
  ) {
    return "active must be boolean.";
  }

  return null;
}

function validateNoOverlap(tiers: PricingTierInput[]): string | null {
  const activeTiers = tiers
    .filter((tier) => tier.active !== false)
    .sort((a, b) => a.minPeople - b.minPeople);

  for (let i = 1; i < activeTiers.length; i++) {
    const previous = activeTiers[i - 1];
    const current = activeTiers[i];

    if (current.minPeople <= previous.maxPeople) {
      return `Pricing tiers overlap: ${previous.minPeople}-${previous.maxPeople} and ${current.minPeople}-${current.maxPeople}.`;
    }
  }

  return null;
}

function validateCoverage(
  tiers: PricingTierInput[],
  capacity: number,
): string | null {
  const activeTiers = tiers
    .filter((tier) => tier.active !== false)
    .sort((a, b) => a.minPeople - b.minPeople);

  if (activeTiers.length === 0) {
    return "At least one active pricing tier is required.";
  }

  if (activeTiers[0].minPeople !== 1) {
    return "Pricing tiers must start at 1 person.";
  }

  if (activeTiers[activeTiers.length - 1].maxPeople !== capacity) {
    return `Pricing tiers must cover the full capacity up to ${capacity} people.`;
  }

  for (let i = 1; i < activeTiers.length; i++) {
    const previous = activeTiers[i - 1];
    const current = activeTiers[i];

    if (current.minPeople !== previous.maxPeople + 1) {
      return `Pricing tiers must have no gaps between ${previous.minPeople}-${previous.maxPeople} and ${current.minPeople}-${current.maxPeople}.`;
    }
  }

  return null;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  if (!canManage(user.role)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403 },
    );
  }

  const deskId = Number(id);

  if (!Number.isInteger(deskId) || deskId <= 0) {
    return NextResponse.json(
      { error: "Invalid room id" },
      { status: 400 },
    );
  }

  const [room] = await db
    .select({
      id: desks.id,
      name: desks.name,
      type: desks.type,
      capacity: desks.capacity,
      active: desks.active,
    })
    .from(desks)
    .where(eq(desks.id, deskId))
    .limit(1);

  if (!room) {
    return NextResponse.json(
      { error: "Room not found" },
      { status: 404 },
    );
  }

  if (room.type !== "meeting_room") {
    return NextResponse.json(
      { error: "This location is not a meeting room" },
      { status: 400 },
    );
  }

  const tiers = await db
    .select({
      id: meetingRoomPricing.id,
      deskId: meetingRoomPricing.deskId,
      minPeople: meetingRoomPricing.minPeople,
      maxPeople: meetingRoomPricing.maxPeople,
      hourlyRate: meetingRoomPricing.hourlyRate,
      active: meetingRoomPricing.active,
    })
    .from(meetingRoomPricing)
    .where(eq(meetingRoomPricing.deskId, deskId))
    .orderBy(
      meetingRoomPricing.minPeople,
      meetingRoomPricing.maxPeople,
    );

  return NextResponse.json({
    ok: true,
    room,
    tiers,
  });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  if (!canManage(user.role)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403 },
    );
  }

  const deskId = Number(id);

  if (!Number.isInteger(deskId) || deskId <= 0) {
    return NextResponse.json(
      { error: "Invalid room id" },
      { status: 400 },
    );
  }

  let body: PutBody;

  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const [room] = await db
    .select({
      id: desks.id,
      name: desks.name,
      type: desks.type,
      capacity: desks.capacity,
    })
    .from(desks)
    .where(eq(desks.id, deskId))
    .limit(1);

  if (!room) {
    return NextResponse.json(
      { error: "Room not found" },
      { status: 404 },
    );
  }

  if (room.type !== "meeting_room") {
    return NextResponse.json(
      { error: "This location is not a meeting room" },
      { status: 400 },
    );
  }

  const capacity =
    body.capacity === undefined
      ? room.capacity
      : body.capacity;

  if (!validateCapacity(capacity)) {
    return NextResponse.json(
      {
        error:
          "Capacity must be a whole number between 1 and 100.",
      },
      { status: 400 },
    );
  }

  if (!Array.isArray(body.tiers)) {
    return NextResponse.json(
      { error: "tiers must be an array." },
      { status: 400 },
    );
  }

  const tiers: PricingTierInput[] = body.tiers.map((tier) => ({
    minPeople: tier.minPeople,
    maxPeople: tier.maxPeople,
    hourlyRate: tier.hourlyRate,
    active: tier.active !== false,
  }));

  if (tiers.length === 0) {
    return NextResponse.json(
      { error: "At least one pricing tier is required." },
      { status: 400 },
    );
  }

  for (const tier of tiers) {
    const error = validateTier(tier, capacity);

    if (error) {
      return NextResponse.json(
        { error },
        { status: 400 },
      );
    }
  }

  const overlapError = validateNoOverlap(tiers);

  if (overlapError) {
    return NextResponse.json(
      { error: overlapError },
      { status: 400 },
    );
  }

  const coverageError = validateCoverage(
    tiers,
    capacity,
  );

  if (coverageError) {
    return NextResponse.json(
      { error: coverageError },
      { status: 400 },
    );
  }

  try {
    /*
     * We replace the room's complete pricing configuration in one
     * transaction so a failed update cannot leave half the tiers saved.
     */
    await db.transaction(async (tx) => {
      await tx
        .update(desks)
        .set({
          capacity,
        })
        .where(eq(desks.id, deskId));

      await tx
        .delete(meetingRoomPricing)
        .where(eq(meetingRoomPricing.deskId, deskId));

      await tx.insert(meetingRoomPricing).values(
        tiers.map((tier) => ({
          deskId,
          minPeople: tier.minPeople,
          maxPeople: tier.maxPeople,
          hourlyRate: tier.hourlyRate.toFixed(2),
          active: tier.active !== false,
        })),
      );
    });

    const savedTiers = await db
      .select({
        id: meetingRoomPricing.id,
        deskId: meetingRoomPricing.deskId,
        minPeople: meetingRoomPricing.minPeople,
        maxPeople: meetingRoomPricing.maxPeople,
        hourlyRate: meetingRoomPricing.hourlyRate,
        active: meetingRoomPricing.active,
      })
      .from(meetingRoomPricing)
      .where(eq(meetingRoomPricing.deskId, deskId))
      .orderBy(
        meetingRoomPricing.minPeople,
        meetingRoomPricing.maxPeople,
      );

    return NextResponse.json({
      ok: true,
      capacity,
      tiers: savedTiers,
    });
  } catch (error) {
    console.error(
      "PUT /api/desks/[id]/meeting-room-pricing failed:",
      error,
    );

    return NextResponse.json(
      { error: "Failed to save meeting room pricing" },
      { status: 500 },
    );
  }
}