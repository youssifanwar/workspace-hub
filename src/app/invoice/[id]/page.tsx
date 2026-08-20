import { db } from "@/db";
import {
  bookings,
  customers,
  desks,
  bookingItems,
  users,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { getAllSettings, formatMoney } from "@/lib/settings";
import Link from "next/link";
import PrintButton from "@/app/(app)/shift/summary/[id]/PrintButton";

export const dynamic = "force-dynamic";

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const bookingId = Number(id);
  if (!bookingId) notFound();

  const [row] = await db
    .select({
      id: bookings.id,
      status: bookings.status,
      customerName: customers.name,
      customerPhone: customers.phone,
      deskName: desks.name,
      checkedInAt: bookings.checkedInAt,
      checkedOutAt: bookings.checkedOutAt,
      hourlyRate: bookings.hourlyRateSnapshot,
      seatCharge: bookings.seatCharge,
      ordersTotal: bookings.ordersTotal,
      discount: bookings.discount,
      total: bookings.total,
      paidAmount: bookings.paidAmount,
      changeAmount: bookings.changeAmount,
      paymentMethod: bookings.paymentMethod,
      cashierName: users.fullName,
    })
    .from(bookings)
    .innerJoin(customers, eq(customers.id, bookings.customerId))
    .innerJoin(desks, eq(desks.id, bookings.deskId))
    .innerJoin(users, eq(users.id, bookings.userId))
    .where(eq(bookings.id, bookingId))
    .limit(1);
  if (!row) notFound();

  const items = await db
    .select()
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, bookingId));

  const settings = await getAllSettings();

  const durationMs =
    row.checkedOutAt && row.checkedInAt
      ? new Date(row.checkedOutAt).getTime() -
        new Date(row.checkedInAt).getTime()
      : 0;
  const durationH = durationMs / 3_600_000;

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-md mx-auto space-y-4">
        <div className="no-print flex items-center justify-between gap-2">
          <Link href="/dashboard" className="btn btn-ghost">
            ← Dashboard
          </Link>
          <div className="flex gap-2">
            <Link href="/bookings" className="btn btn-primary">
              + New Booking
            </Link>
            <PrintButton />
          </div>
        </div>

        <div className="card p-6 space-y-4 font-mono text-sm" id="invoice">
          <div className="text-center border-b border-dashed border-slate-300 pb-3">
            <div className="text-3xl mb-1">🏢</div>
            <div className="text-lg font-bold">{settings.workspace_name}</div>
            <div className="text-xs text-slate-500">{settings.workspace_address}</div>
            <div className="text-xs text-slate-500">📞 {settings.workspace_phone}</div>
          </div>

          <div className="text-xs space-y-1">
            <Line label="Invoice #" value={String(row.id).padStart(6, "0")} />
            <Line label="Date" value={new Date(row.checkedOutAt || row.checkedInAt).toLocaleString()} />
            <Line label="Cashier" value={row.cashierName} />
            <Line label="Customer" value={row.customerName} />
            <Line label="Phone" value={row.customerPhone} />
            <Line label="Desk" value={row.deskName} />
          </div>

          <div className="border-t border-b border-dashed border-slate-300 py-3">
            <div className="text-xs font-bold mb-2">TIME</div>
            <Line
              label="Check-in"
              value={new Date(row.checkedInAt).toLocaleTimeString()}
            />
            <Line
              label="Check-out"
              value={
                row.checkedOutAt
                  ? new Date(row.checkedOutAt).toLocaleTimeString()
                  : "-"
              }
            />
            <Line label="Duration" value={`${durationH.toFixed(2)} hours`} />
            <Line
              label="Rate"
              value={`${parseFloat(row.hourlyRate).toFixed(2)} ${settings.currency}/h`}
            />
          </div>

          {items.length > 0 && (
            <div className="border-b border-dashed border-slate-300 pb-3">
              <div className="text-xs font-bold mb-2">ITEMS</div>
              {items.map((it) => (
                <div
                  key={it.id}
                  className="flex items-start justify-between text-xs py-0.5"
                >
                  <div className="flex-1">
                    <div>{it.nameSnapshot}</div>
                    <div className="text-[10px] text-slate-500">
                      {parseFloat(it.unitPrice).toFixed(2)} × {it.quantity}
                    </div>
                  </div>
                  <div className="font-bold tabular-nums">
                    {(it.quantity * parseFloat(it.unitPrice)).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1 text-xs">
            <Line
              label="Seat charge"
              value={formatMoney(parseFloat(row.seatCharge || "0"), settings.currency)}
            />
            <Line
              label="F&B"
              value={formatMoney(parseFloat(row.ordersTotal || "0"), settings.currency)}
            />
            {parseFloat(row.discount || "0") > 0 && (
              <Line
                label="Discount"
                value={`- ${formatMoney(parseFloat(row.discount), settings.currency)}`}
              />
            )}
            <div className="flex items-center justify-between text-lg font-bold pt-2 border-t border-slate-300">
              <span>TOTAL</span>
              <span className="tabular-nums">
                {formatMoney(parseFloat(row.total || "0"), settings.currency)}
              </span>
            </div>
          </div>

          <div className="border-t border-dashed border-slate-300 pt-3 space-y-1 text-xs">
            <Line
              label="Payment"
              value={(row.paymentMethod || "").toUpperCase()}
            />
            <Line
              label="Paid"
              value={formatMoney(parseFloat(row.paidAmount || "0"), settings.currency)}
            />
            {parseFloat(row.changeAmount || "0") > 0 && (
              <Line
                label="Change"
                value={formatMoney(parseFloat(row.changeAmount || "0"), settings.currency)}
              />
            )}
          </div>

          <div className="text-center pt-3 border-t border-dashed border-slate-300">
            <div className="text-xs text-slate-500">{settings.invoice_footer}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold text-right">{value}</span>
    </div>
  );
}
