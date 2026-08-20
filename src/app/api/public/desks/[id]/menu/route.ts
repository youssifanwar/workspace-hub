import { NextResponse } from "next/server";
import { db } from "@/db";
import { desks, categories, products, bookings, customers } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Public endpoint reached by a customer scanning the desk's QR code.
 * Returns the desk info + current booking (if any) + full menu.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const deskId = Number(id);
  if (!deskId)
    return NextResponse.json({ error: "Invalid desk id" }, { status: 400 });

  const [desk] = await db
    .select()
    .from(desks)
    .where(and(eq(desks.id, deskId), eq(desks.active, true)))
    .limit(1);
  if (!desk)
    return NextResponse.json({ error: "Desk not found" }, { status: 404 });

  const [activeBooking] = await db
    .select({
      id: bookings.id,
      customerName: customers.name,
      checkedInAt: bookings.checkedInAt,
    })
    .from(bookings)
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .where(and(eq(bookings.deskId, deskId), eq(bookings.status, "active")))
    .limit(1);

  const cats = await db
    .select()
    .from(categories)
    .orderBy(asc(categories.sortOrder));
  const prods = await db
    .select()
    .from(products)
    .where(eq(products.active, true))
    .orderBy(asc(products.name));

  return NextResponse.json({
    desk: { id: desk.id, name: desk.name, type: desk.type },
    booking: activeBooking
      ? {
          id: activeBooking.id,
          customerName: activeBooking.customerName,
          checkedInAt: activeBooking.checkedInAt,
        }
      : null,
    categories: cats.map((c) => ({ id: c.id, name: c.name, icon: c.icon })),
    products: prods.map((p) => ({
      id: p.id,
      categoryId: p.categoryId,
      name: p.name,
      price: p.price,
      icon: p.icon,
      imageUrl: p.imageUrl,
    })),
  });
}
