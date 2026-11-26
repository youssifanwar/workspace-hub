import { NextResponse } from "next/server";
import crypto from "crypto";
import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { bookings, orderTickets } from "@/db/schema";
import { bookingAccessCondition } from "@/lib/customer-session";

export const dynamic = "force-dynamic";

const CUSTOMER_COOKIE = "wsh_customer_session";

function cookieValue(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";").map((p) => p.trim())) {
    if (part.startsWith(`${name}=`)) {
      try {
        return decodeURIComponent(part.slice(name.length + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// Read-only: the order tickets of the caller's own active session, status only.
export async function GET(req: Request) {
  try {
    const raw = cookieValue(req.headers.get("cookie"), CUSTOMER_COOKIE);
    if (!raw) return NextResponse.json({ orders: [] });
    const hash = crypto.createHash("sha256").update(raw).digest("hex");

    const [booking] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(bookingAccessCondition(hash), eq(bookings.status, "active")))
      .limit(1);
    if (!booking) return NextResponse.json({ orders: [] });

    const rows = await db
      .select({
        ticketNumber: orderTickets.ticketNumber,
        status: orderTickets.status,
        createdAt: orderTickets.createdAt,
      })
      .from(orderTickets)
      .where(and(eq(orderTickets.bookingId, booking.id), eq(orderTickets.source, "qr")))
      .orderBy(desc(orderTickets.createdAt))
      .limit(5);

    return NextResponse.json({ orders: rows });
  } catch {
    return NextResponse.json({ orders: [] });
  }
}
