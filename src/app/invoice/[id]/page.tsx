import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import {
  bookings,
  bookingItems,
  customers,
  desks,
  users,
} from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { getLang } from "@/lib/i18n";
import { makeFmt } from "@/lib/i18n-shared";
import { getAllSettings, formatMoney } from "@/lib/settings";

import PrintButton from "@/app/(app)/shift/summary/[id]/PrintButton";

export const dynamic = "force-dynamic";

function safeNumber(value: unknown, fallback = 0): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number(value)
      : NaN;

  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeMoney(value: unknown): number {
  const parsed = safeNumber(value, 0);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.round(parsed * 100) / 100;
}

function safeDate(
  value: Date | string | null | undefined,
): Date | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function formatDateTime(
  value: Date | string | null | undefined,
): string {
  const date = safeDate(value);

  return date ? date.toLocaleString() : "-";
}

function formatTime(
  value: Date | string | null | undefined,
): string {
  const date = safeDate(value);

  return date ? date.toLocaleTimeString() : "-";
}

function calculateDurationHours(
  start: Date | null,
  end: Date | null,
): number {
  if (!start || !end) {
    return 0;
  }

  const durationMs = end.getTime() - start.getTime();

  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return 0;
  }

  return durationMs / 3_600_000;
}

export default async function InvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const f = makeFmt(await getLang());
  const tx = f.t;
  const { id } = await params;

  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const bookingId = Number(id);

  if (
    !Number.isSafeInteger(bookingId) ||
    bookingId <= 0
  ) {
    notFound();
  }

  const [row, items, settings] = await Promise.all([
    db
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
      .innerJoin(
        customers,
        eq(customers.id, bookings.customerId),
      )
      .leftJoin(
        desks,
        eq(desks.id, bookings.deskId),
      )
      .innerJoin(
        users,
        eq(users.id, bookings.userId),
      )
      .where(eq(bookings.id, bookingId))
      .limit(1),

    db
      .select({
        id: bookingItems.id,
        nameSnapshot: bookingItems.nameSnapshot,
        quantity: bookingItems.quantity,
        unitPrice: bookingItems.unitPrice,
      })
      .from(bookingItems)
      .where(eq(bookingItems.bookingId, bookingId)),

    getAllSettings(),
  ]);

  if (!row[0]) {
    notFound();
  }

  const booking = row[0];

  const checkedInAt = safeDate(booking.checkedInAt);
  const checkedOutAt = safeDate(booking.checkedOutAt);

  if (!checkedInAt) {
    notFound();
  }

  const durationH = calculateDurationHours(
    checkedInAt,
    checkedOutAt,
  );

  const billableHours =
    durationH > 0 ? Math.max(1, Math.ceil(durationH)) : 0;

  /*
   * Important:
   * Historical invoice values come from the booking snapshots.
   * We do NOT recalculate the session price from current settings.
   */
  const hourlyRate = safeMoney(
    booking.hourlyRate,
  );

  const seatCharge = safeMoney(
    booking.seatCharge,
  );

  const ordersTotal = safeMoney(
    booking.ordersTotal,
  );

  const discount = safeMoney(
    booking.discount,
  );

  const storedTotal = safeMoney(
    booking.total,
  );

  const calculatedTotal = Math.max(
    0,
    Math.round(
      (seatCharge + ordersTotal - discount) * 100,
    ) / 100,
  );

  const total =
    booking.total !== null &&
    booking.total !== undefined
      ? storedTotal
      : calculatedTotal;

  const paidAmount = safeMoney(
    booking.paidAmount,
  );

  const changeAmount = safeMoney(
    booking.changeAmount,
  );

  const currency =
    settings.currency?.trim() || "EGP";

  const paymentMethod =
    booking.paymentMethod?.trim() || "-";

  const customerName =
    booking.customerName?.trim() ||
    tx("Walk-in Customer");

  const customerPhone =
    booking.customerPhone?.trim() || "-";

  const cashierName =
    booking.cashierName?.trim() || "-";

  const workspaceName =
    settings.workspace_name?.trim() ||
    "WorkSpace Hub";

  const workspaceAddress =
    settings.workspace_address?.trim() || "";

  const workspacePhone =
    settings.workspace_phone?.trim() || "";

  const invoiceFooter =
    settings.invoice_footer?.trim() || "";

  return (
    <div className="min-h-screen py-8 px-4">
      <div className="max-w-md mx-auto space-y-4">
        {/* TOP ACTIONS */}
        <div className="no-print flex items-center justify-between gap-2">
          <Link
            href="/dashboard"
            className="btn btn-ghost"
          >
            {tx("← Dashboard")}
          </Link>

          <div className="flex gap-2">
            <Link
              href="/bookings"
              className="btn btn-primary"
            >
              {tx("+ New Session")}
            </Link>

            <PrintButton />
          </div>
        </div>

        {/* INVOICE */}
        <div
          className="card p-6 space-y-4 font-mono text-sm"
          id="invoice"
        >
          {/* HEADER */}
          <div className="text-center border-b border-dashed border-slate-300 pb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/scope-logo-brown.png" alt="" width={909} height={486} style={{ height: 56, width: "auto", margin: "0 auto 6px" }} />

            <div className="text-lg font-bold">
              {workspaceName}
            </div>

            {workspaceAddress && (
              <div className="text-xs text-slate-500">
                {workspaceAddress}
              </div>
            )}

            {workspacePhone && (
              <div className="text-xs text-slate-500">
                📞 {workspacePhone}
              </div>
            )}
          </div>

          {/* BASIC INFO */}
          <div className="text-xs space-y-1">
            <Line
              label={tx("Invoice #")}
              value={String(booking.id).padStart(6, "0")}
            />

            <Line
              label={tx("Date")}
              value={f.dateTime(
                booking.checkedOutAt ||
                  booking.checkedInAt,
              )}
            />

            <Line
              label={tx("Cashier")}
              value={cashierName}
            />

            <Line
              label={tx("Customer")}
              value={customerName}
            />

            <Line
              label={tx("Phone")}
              value={customerPhone}
            />

            <Line
              label={tx("Session")}
              value={`#${booking.id}`}
            />

            <Line
              label={tx("Location")}
              value={
                booking.deskName?.trim() ||
                tx("Workspace Session")
              }
            />
          </div>

          {/* TIME */}
          <div className="border-t border-b border-dashed border-slate-300 py-3">
            <div className="text-xs font-bold mb-2">
              {tx("TIME")}
            </div>

            <Line
              label={tx("Check-in")}
              value={f.time(
                booking.checkedInAt,
              )}
            />

            <Line
              label={tx("Check-out")}
              value={f.time(
                booking.checkedOutAt,
              )}
            />

            <Line
              label={tx("Duration")}
              value={
                durationH > 0
                  ? `${durationH.toFixed(2)} ${tx("hours")}`
                  : "-"
              }
            />

            <Line
              label={tx("Billed hours")}
              value={
                billableHours > 0
                  ? String(billableHours)
                  : "-"
              }
            />

            <Line
              label={tx("Rate")}
              value={
                hourlyRate > 0
                  ? `${hourlyRate.toFixed(
                      2,
                    )} ${currency}/${tx("h")}`
                  : tx("Package / Included")
              }
            />
          </div>

          {/* F&B ITEMS */}
          {items.length > 0 && (
            <div className="border-b border-dashed border-slate-300 pb-3">
              <div className="text-xs font-bold mb-2">
                {tx("ITEMS")}
              </div>

              {items.map((item) => {
                const quantity = Math.max(
                  0,
                  safeNumber(item.quantity, 0),
                );

                const unitPrice = safeMoney(
                  item.unitPrice,
                );

                const lineTotal = Math.round(
                  quantity * unitPrice * 100,
                ) / 100;

                return (
                  <div
                    key={item.id}
                    className="flex items-start justify-between text-xs py-0.5"
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      <div className="break-words">
                        {item.nameSnapshot ||
                          tx("Unnamed item")}
                      </div>

                      <div className="text-[10px] text-slate-500">
                        {unitPrice.toFixed(2)} ×{" "}
                        {quantity}
                      </div>
                    </div>

                    <div className="font-bold tabular-nums shrink-0">
                      {lineTotal.toFixed(2)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* TOTALS */}
          <div className="space-y-1 text-xs">
            <Line
              label={tx("Seat charge")}
              value={f.money(seatCharge)}
            />

            <Line
              label={tx("F&B")}
              value={f.money(ordersTotal)}
            />

            {discount > 0 && (
              <Line
                label={tx("Discount")}
                value={`- ${f.money(discount)}`}
              />
            )}

            <div className="flex items-center justify-between text-lg font-bold pt-2 border-t border-slate-300">
              <span>{tx("TOTAL")}</span>

              <span className="tabular-nums">
                {f.money(total)}
              </span>
            </div>
          </div>

          {/* PAYMENT */}
          <div className="border-t border-dashed border-slate-300 pt-3 space-y-1 text-xs">
            <Line
              label={tx("Payment")}
              value={f.pay(paymentMethod)}
            />

            <Line
              label={tx("Paid")}
              value={f.money(paidAmount)}
            />

            {changeAmount > 0 && (
              <Line
                label={tx("Change")}
                value={f.money(changeAmount)}
              />
            )}
          </div>

          {/* FOOTER */}
          {invoiceFooter && (
            <div className="text-center pt-3 border-t border-dashed border-slate-300">
              <div className="text-xs text-slate-500 whitespace-pre-wrap">
                {invoiceFooter}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Line({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500">
        {label}
      </span>

      <span className="font-semibold text-right break-words">
        {value}
      </span>
    </div>
  );
}