import { NextResponse } from "next/server";
import { db } from "@/db";
import { bookings, bookingItems, products } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const shift = await getActiveShiftForUser(user.id);
  if (!shift) return NextResponse.json({ error: "No active shift" }, { status: 400 });

  const bookingId = Number(id);
  const body = (await req.json()) as { productId?: number; quantity?: number };
  if (!body.productId)
    return NextResponse.json({ error: "productId required" }, { status: 400 });

  const [b] = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.id, bookingId), eq(bookings.status, "active")))
    .limit(1);
  if (!b)
    return NextResponse.json({ error: "Active booking not found" }, { status: 404 });

  const [p] = await db
    .select()
    .from(products)
    .where(eq(products.id, body.productId))
    .limit(1);
  if (!p)
    return NextResponse.json({ error: "Product not found" }, { status: 404 });

  const quantity = Math.max(1, Math.floor(body.quantity || 1));
  const [item] = await db
    .insert(bookingItems)
    .values({
      bookingId,
      productId: p.id,
      nameSnapshot: p.name,
      unitPrice: p.price,
      quantity,
    })
    .returning();

  return NextResponse.json({
    ok: true,
    item: {
      id: item.id,
      name: item.nameSnapshot,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
    },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const bookingId = Number(id);
  const body = (await req.json()) as { itemId?: number; quantity?: number };
  if (!body.itemId || !body.quantity)
    return NextResponse.json({ error: "itemId and quantity required" }, { status: 400 });

  await db
    .update(bookingItems)
    .set({ quantity: Math.max(1, Math.floor(body.quantity)) })
    .where(and(eq(bookingItems.id, body.itemId), eq(bookingItems.bookingId, bookingId)));

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const itemId = Number(url.searchParams.get("itemId"));
  if (!itemId)
    return NextResponse.json({ error: "itemId required" }, { status: 400 });
  const bookingId = Number(id);

  await db
    .delete(bookingItems)
    .where(and(eq(bookingItems.id, itemId), eq(bookingItems.bookingId, bookingId)));

  return NextResponse.json({ ok: true });
}
