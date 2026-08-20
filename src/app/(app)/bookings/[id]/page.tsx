import { db } from "@/db";
import {
  bookings,
  customers,
  desks,
  bookingItems,
  categories,
  products,
} from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";
import { redirect, notFound } from "next/navigation";
import { getSetting } from "@/lib/settings";
import BookingView from "./BookingView";

export const dynamic = "force-dynamic";

export default async function BookingDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const shift = await getActiveShiftForUser(user.id);
  if (!shift) redirect("/shift");

  const bookingId = Number(id);
  if (!bookingId) notFound();

  const [row] = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      customerName: customers.name,
      customerPhone: customers.phone,
      deskId: desks.id,
      deskName: desks.name,
      deskType: desks.type,
      checkedInAt: bookings.checkedInAt,
      hourlyRate: bookings.hourlyRateSnapshot,
      ordersTotal: bookings.ordersTotal,
      discount: bookings.discount,
    })
    .from(bookings)
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .innerJoin(desks, eq(desks.id, bookings.deskId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row) notFound();
  if (row.status === "closed") redirect(`/invoice/${bookingId}`);

  const items = await db
    .select()
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, bookingId))
    .orderBy(asc(bookingItems.createdAt));

  const cats = await db.select().from(categories).orderBy(asc(categories.sortOrder));
  const prods = await db
    .select()
    .from(products)
    .where(eq(products.active, true))
    .orderBy(asc(products.name));

  const currency = await getSetting("currency");

  return (
    <BookingView
      booking={{
        id: row.id,
        customerName: row.customerName,
        customerPhone: row.customerPhone,
        deskName: row.deskName,
        deskType: row.deskType,
        checkedInAt: row.checkedInAt.toISOString(),
        hourlyRate: row.hourlyRate,
        ordersTotal: row.ordersTotal,
        discount: row.discount,
      }}
      items={items.map((i) => ({
        id: i.id,
        name: i.nameSnapshot,
        unitPrice: i.unitPrice,
        quantity: i.quantity,
      }))}
      categories={cats.map((c) => ({ id: c.id, name: c.name, icon: c.icon }))}
      products={prods.map((p) => ({
        id: p.id,
        categoryId: p.categoryId,
        name: p.name,
        price: p.price,
        imageUrl: p.imageUrl,
        icon: p.icon,
      }))}
      currency={currency}
    />
  );
}

// suppress unused warning
void and;
