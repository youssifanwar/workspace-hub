import { NextResponse } from "next/server";
import crypto from "crypto";

import { db } from "@/db";
import { bookings } from "@/db/schema";
import { and, eq } from "drizzle-orm";

import { getCurrentUser } from "@/lib/auth";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  const { id } = await params;
  const bookingId = Number(id);

  if (!Number.isInteger(bookingId) || bookingId <= 0) {
    return NextResponse.json(
      { error: "Invalid booking id" },
      { status: 400 },
    );
  }

  const [booking] = await db
    .select({
      id: bookings.id,
      accessTokenHash: bookings.accessTokenHash,
      accessTokenCreatedAt: bookings.accessTokenCreatedAt,
      status: bookings.status,
    })
    .from(bookings)
    .where(
      and(
        eq(bookings.id, bookingId),
        eq(bookings.status, "active"),
      ),
    )
    .limit(1);

  if (!booking) {
    return NextResponse.json(
      { error: "Active session not found" },
      { status: 404 },
    );
  }

  if (!booking.accessTokenHash) {
    return NextResponse.json(
      { error: "This session has no device token." },
      { status: 400 },
    );
  }

  // For now we do not expose the permanent access token.
  // The next step will create a short-lived one-time pairing token.
  return NextResponse.json({
    ok: false,
    error: "Pairing link generation is not enabled yet.",
  });
}