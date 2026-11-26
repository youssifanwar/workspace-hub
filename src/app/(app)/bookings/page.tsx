import { PageBar, StatStrip, Panel } from "../_components/ui";
import { db } from "@/db";
import { bookingItems, bookings, customers } from "@/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getActiveShiftForUser } from "@/lib/shift";
import { getLang } from "@/lib/i18n";
import { makeFmt } from "@/lib/i18n-shared";
import {
  calculateCustomerSessionSeatCharge,
  getCustomerSessionPricing,
  getSetting,
  type CustomerSessionPricing,
} from "@/lib/settings";
import OpenSessionButton from "./OpenSessionButton";
import QuickCancelButton from "./QuickCancelButton";
import Link from "next/link";
import BookingsLiveRefresh from "./BookingsLiveRefresh";
import { activeTimeZone, loadTimezone } from "@/lib/timezone";

export const dynamic = "force-dynamic";

/* -------------------------------------------------------------------------- */
/* TYPES                                                                      */
/* -------------------------------------------------------------------------- */

type BillingMode =
  | "regular"
  | "package";

/* -------------------------------------------------------------------------- */
/* PAGE                                                                       */
/* -------------------------------------------------------------------------- */

export default async function BookingsPage() {
  const f = makeFmt(await getLang());
  const tx = f.t;
  const user =
    await getCurrentUser();
  await loadTimezone();

  if (!user) {
    redirect("/login");
  }

  const activeShift =
    await getActiveShiftForUser(
      user.id,
    );

  if (!activeShift) {
    redirect("/shift");
  }

  const [
    currency,
    pricing,
  ] = await Promise.all([
    getSetting("currency"),
    getCustomerSessionPricing(),
  ]);

  const activeSessionsRaw =
    await db
      .select({
        id: bookings.id,

        customerName:
          customers.name,

        customerPhone:
          customers.phone,

        accessCode:
          bookings.accessCode,

        checkedInAt:
          bookings.checkedInAt,

        /*
         * Legacy field.
         *
         * Customer Session billing does NOT use this field.
         */
        hourlyRate:
          bookings.hourlyRateSnapshot,

        ordersTotal:
          bookings.ordersTotal,

        discount:
          bookings.discount,

        status:
          bookings.status,

        billingMode:
          bookings.billingMode,

        subscriptionId:
          bookings.subscriptionId,
      })
      .from(bookings)
      .innerJoin(
        customers,
        eq(
          customers.id,
          bookings.customerId,
        ),
      )
      .where(
        and(
          eq(
            bookings.status,
            "active",
          ),
          /*
           * A meeting-room check-in also creates a row in this same
           * `bookings` table (so F&B orders have somewhere to attach),
           * with deskId pointing at the meeting room. Without this
           * filter, meeting room sessions showed up here too and were
           * billed using the regular open-seating (customer session)
           * hourly tiers instead of their own per-room/per-person rate.
           * Open ("shared") sessions always have deskId = null.
           */
          isNull(bookings.deskId),
        ),
      )
      .orderBy(
        bookings.checkedInAt,
      );

  /*
   * Read F&B totals from booking_items, not bookings.ordersTotal.
   * QR orders are stored as booking_items, while ordersTotal can remain a
   * historical snapshot until checkout.
   */
  const activeBookingIds = activeSessionsRaw.map(
    (session) => session.id,
  );

  const fnbTotalsRows =
    activeBookingIds.length > 0
      ? await db
          .select({
            bookingId: bookingItems.bookingId,
            total: sql<string>`
              COALESCE(
                SUM(
                  CAST(${bookingItems.unitPrice} AS numeric) *
                  ${bookingItems.quantity}
                ),
                0
              )
            `,
          })
          .from(bookingItems)
          .where(
            inArray(
              bookingItems.bookingId,
              activeBookingIds,
            ),
          )
          .groupBy(bookingItems.bookingId)
      : [];

  const fnbTotals = new Map(
    fnbTotalsRows.map((row) => [
      row.bookingId,
      Number(row.total ?? 0),
    ]),
  );

  /*
   * Normalize billingMode here.
   *
   * Drizzle can infer the database column as string in this query.
   * SessionCard intentionally accepts only the two valid application modes.
   */
  const activeSessions =
    activeSessionsRaw.map(
      (session) => ({
        id: session.id,

        customerName:
          session.customerName,

        customerPhone:
          session.customerPhone,

        accessCode:
          session.accessCode,

        checkedInAt:
          session.checkedInAt,

        hourlyRate:
          session.hourlyRate,

        ordersTotal:
          (fnbTotals.get(session.id) ??
            Number(session.ordersTotal ?? 0)).toFixed(2),

        discount:
          session.discount,

        status:
          session.status,

        billingMode:
          session.billingMode ===
          "package"
            ? ("package" as const)
            : ("regular" as const),

        subscriptionId:
          session.subscriptionId,
      }),
    );

  const staleRaw = Number(await getSetting("stale_session_hours"));
  const staleHours =
    Number.isFinite(staleRaw) && staleRaw > 0 ? staleRaw : 10;
  const staleSessions = activeSessions.filter(
    (session) =>
      Date.now() - session.checkedInAt.getTime() >
      staleHours * 3_600_000,
  );

  const calcs = activeSessions.map((x) => calcSession(x as SessionData, pricing));
  const fnbSum = calcs.reduce((n, x) => n + x.ordersTotal, 0);
  const totalSum = calcs.reduce((n, x) => n + x.currentTotal, 0);

  return (
    <div>
      <BookingsLiveRefresh />

      {staleSessions.length > 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <div className="font-bold text-amber-900">
            ⚠️ {staleSessions.length} session
            {staleSessions.length === 1 ? "" : "s"} open for more than{" "}
            {staleHours} hours — possibly forgotten
          </div>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {staleSessions.map((session) => (
              <li key={session.id}>
                <Link
                  href={`/bookings/${session.id}`}
                  className="underline"
                >
                  #{session.id} — {session.customerName ?? tx("Customer")}
                </Link>{" "}
                {tx("since")} {session.checkedInAt.toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      )}
      <PageBar
        crumb={tx("Operations")}
        title={tx("Customer Sessions")}
        description={tx("Manage active customer sessions, timing, orders and billing.")}
        actions={<OpenSessionButton currency={currency} />}
      />

      <StatStrip
        items={[
          { label: tx("Active"), value: activeSessions.length, tone: "green" },
          { label: tx("F&B"), value: `${fnbSum.toFixed(2)} ${currency}`, tone: "amber" },
          { label: tx("Current Total"), value: `${totalSum.toFixed(2)} ${currency}`, tone: "brand" },
        ]}
      />

      {activeSessions.length === 0 ? (
        <Panel>
          <div className="v2-empty">
            <div style={{ fontSize: 40, marginBottom: 8 }}>👤</div>
            <b style={{ color: "#111827", fontSize: 16 }}>{tx("No active customer sessions")}</b>
            <p style={{ margin: "6px 0 18px" }}>{tx("Start a session when a customer enters the workspace.")}</p>
            <OpenSessionButton currency={currency} />
          </div>
        </Panel>
      ) : (
        <Panel title={tx("Live sessions")} meta={String(activeSessions.length)} flush>
          <div className="x-table-wrap">
            <table className="v2-tbl">
              <thead>
                <tr>
                  <th>{tx("Customer")}</th>
                  <th>{tx("Session")}</th>
                  <th>{tx("Access Code")}</th>
                  <th>{tx("Started")}</th>
                  <th>{tx("Duration")}</th>
                  <th>{tx("Billing")}</th>
                  <th className="num">{tx("Seat")}</th>
                  <th className="num">{tx("F&B")}</th>
                  <th className="num">{tx("Current Total")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {activeSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    currency={currency}
                    pricing={pricing}
                    tx={tx}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SESSION CARD                                                               */
/* -------------------------------------------------------------------------- */

type SessionData = {
  id: number;
  customerName: string;
  customerPhone: string | null;
  accessCode: string | null;
  checkedInAt: Date;
  hourlyRate: string;
  ordersTotal: string;
  discount: string;
  status: "active" | "closed" | string;
  billingMode: BillingMode;
  subscriptionId: number | null;
};

function calcSession(session: SessionData, pricing: CustomerSessionPricing) {
  const durationMs = Math.max(0, Date.now() - session.checkedInAt.getTime());
  // Every started hour counts as one billable hour (same rule as before).
  const billableHours = Math.max(1, Math.ceil(durationMs / 3_600_000));
  const ordersTotal = parseFloat(session.ordersTotal || "0");
  const discount = parseFloat(session.discount || "0");
  const seatCharge =
    session.billingMode === "package"
      ? 0
      : calculateCustomerSessionSeatCharge(billableHours, pricing);
  const currentTotal = Math.max(0, seatCharge + ordersTotal - discount);
  return { durationMs, billableHours, ordersTotal, discount, seatCharge, currentTotal };
}

function SessionRow({
  session,
  currency,
  pricing,
  tx,
}: {
  tx: (s: string) => string;
  session: SessionData;
  currency: string;
  pricing: CustomerSessionPricing;
}) {
  const c = calcSession(session, pricing);
  const isPackage = session.billingMode === "package";
  const initials = (session.customerName || "?").trim().slice(0, 1);
  return (
    <tr>
      <td>
        <Link href={`/bookings/${session.id}`} className="v2-prod" style={{ textDecoration: "none" }}>
          <span className="v2-prod-ico" style={{ background: "var(--v2-brand-soft)", color: "var(--v2-brand)", fontWeight: 800, fontSize: 15 }}>
            {initials}
          </span>
          <span>
            <b style={{ color: "#111827", display: "block" }}>{session.customerName}</b>
            {session.customerPhone && (
              <span className="muted" dir="ltr" style={{ fontSize: 12, color: "#6b7280" }}>{session.customerPhone}</span>
            )}
          </span>
        </Link>
      </td>
      <td className="muted">#{session.id}</td>
      <td style={{ fontFamily: "ui-monospace, monospace", letterSpacing: ".08em", fontWeight: 700 }}>
        {session.accessCode || "----"}
      </td>
      <td className="muted">{formatTime(session.checkedInAt)}</td>
      <td style={{ fontFamily: "ui-monospace, monospace", fontWeight: 700 }}>{formatDuration(c.durationMs)}</td>
      <td>
        <span className={`v2-tag ${isPackage ? "blue" : "green"}`}>
          {isPackage ? tx("Package") : tx("Regular")}
        </span>
        {!isPackage && c.billableHours > 4 && (
          <span className="v2-tag slate" style={{ marginInlineStart: 6 }}>{tx("Day Pass")}</span>
        )}
      </td>
      <td className="num">{c.seatCharge.toFixed(2)} {currency}</td>
      <td className="num">{c.ordersTotal.toFixed(2)} {currency}</td>
      <td className="num" style={{ color: "var(--v2-brand)", fontSize: 15 }}>
        {c.currentTotal.toFixed(2)} {currency}
        {c.discount > 0 && (
          <div style={{ color: "#b91c1c", fontSize: 11 }}>-{c.discount.toFixed(2)}</div>
        )}
      </td>
      <td>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          <Link href={`/bookings/${session.id}`} className="btn btn-primary" style={{ minHeight: 34, padding: "0 14px" }}>
            {tx("Open session →")}
          </Link>
          <QuickCancelButton bookingId={session.id} />
        </div>
      </td>
    </tr>
  );
}

/* -------------------------------------------------------------------------- */
/* SMALL UI                                                                   */
/* -------------------------------------------------------------------------- */

function InfoBox({
  label,
  value,
  mono = false,
}: {
  label: string;

  value: string;

  mono?: boolean;
}) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
        {label}
      </div>

      <div
        className={`mt-1 text-sm font-bold text-slate-800 ${
          mono
            ? "font-mono tracking-wider"
            : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* TIME                                                                       */
/* -------------------------------------------------------------------------- */

function formatTime(
  date: Date,
) {
  return date.toLocaleTimeString(
    "en-EG",
    {
      timeZone: activeTimeZone(),
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    },
  );
}

function formatDuration(
  ms: number,
) {
  const totalSeconds =
    Math.floor(
      ms / 1000,
    );

  const hours =
    Math.floor(
      totalSeconds / 3600,
    );

  const minutes =
    Math.floor(
      (totalSeconds %
        3600) /
        60,
    );

  const seconds =
    totalSeconds % 60;

  return `${String(
    hours,
  ).padStart(
    2,
    "0",
  )}:${String(
    minutes,
  ).padStart(
    2,
    "0",
  )}:${String(
    seconds,
  ).padStart(
    2,
    "0",
  )}`;
}