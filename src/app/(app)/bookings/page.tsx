import { db } from "@/db";
import {
  bookings,
  customers,
  meetingRoomReservations,
} from "@/db/schema";
import {
  and,
  eq,
  notExists,
} from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getActiveShiftForUser } from "@/lib/shift";
import { getSetting } from "@/lib/settings";
import OpenSessionButton from "./OpenSessionButton";
import Link from "next/link";

export const dynamic = "force-dynamic";

/* -------------------------------------------------------------------------- */
/* SESSION PRICING                                                            */
/* -------------------------------------------------------------------------- */

const FIRST_HOUR_PRICE = 40;
const EXTRA_HOUR_PRICE = 30;
const DAY_PASS_PRICE = 150;

function calculateRegularSeatCharge(
  billableHours: number,
) {
  if (billableHours <= 1) {
    return FIRST_HOUR_PRICE;
  }

  if (billableHours === 2) {
    return FIRST_HOUR_PRICE + EXTRA_HOUR_PRICE;
  }

  if (billableHours === 3) {
    return (
      FIRST_HOUR_PRICE +
      EXTRA_HOUR_PRICE * 2
    );
  }

  if (billableHours === 4) {
    return (
      FIRST_HOUR_PRICE +
      EXTRA_HOUR_PRICE * 3
    );
  }

  return DAY_PASS_PRICE;
}

export default async function BookingsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const activeShift =
    await getActiveShiftForUser(user.id);

  if (!activeShift) {
    redirect("/shift");
  }

  const currency =
    await getSetting("currency");

  const activeSessionsRaw =
    await db
      .select({
        id: bookings.id,
        customerName: customers.name,
        customerPhone: customers.phone,
        accessCode: bookings.accessCode,
        checkedInAt: bookings.checkedInAt,

        /*
         * Kept because older bookings may still have this value.
         * The UI pricing below does NOT depend on it for regular sessions.
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
          notExists(
            db
              .select({
                id:
                  meetingRoomReservations.id,
              })
              .from(
                meetingRoomReservations,
              )
              .where(
                eq(
                  meetingRoomReservations.bookingId,
                  bookings.id,
                ),
              ),
          ),
        ),
      )
      .orderBy(
        bookings.checkedInAt,
      );

  const activeSessions = activeSessionsRaw.map((session) => ({
    ...session,
    billingMode:
      session.billingMode === "package"
        ? ("package" as const)
        : ("regular" as const),
  }));

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Customer Sessions
          </h1>

          <p className="text-slate-500 mt-1">
            Manage active customer sessions, timing, orders and billing.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-4 py-2 rounded-xl bg-emerald-100 text-emerald-800 font-semibold text-sm">
            Active {activeSessions.length}
          </div>

          <OpenSessionButton
            currency={currency}
          />
        </div>
      </div>

      {/* EMPTY STATE */}
      {activeSessions.length === 0 ? (
        <div className="rounded-3xl border-2 border-dashed border-slate-300 bg-white p-12 text-center">
          <div className="text-5xl mb-4">
            👤
          </div>

          <h2 className="text-xl font-bold text-slate-900">
            No active customer sessions
          </h2>

          <p className="text-slate-500 mt-2">
            Start a session when a customer enters the workspace.
          </p>

          <div className="mt-6">
            <OpenSessionButton
              currency={currency}
            />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
          {activeSessions.map(
            (session) => (
              <SessionCard
                key={session.id}
                session={session}
                currency={currency}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* SESSION CARD                                                               */
/* -------------------------------------------------------------------------- */

function SessionCard({
  session,
  currency,
}: {
  session: {
    id: number;
    customerName: string;
    customerPhone: string | null;
    accessCode: string | null;
    checkedInAt: Date;
    hourlyRate: string;
    ordersTotal: string;
    discount: string;
    status: string;
    billingMode: "regular" | "package";
    subscriptionId: number | null;
  };
  currency: string;
}) {
  const startedAt =
    session.checkedInAt.getTime();

  const now = Date.now();

  const durationMs =
    Math.max(
      0,
      now - startedAt,
    );

  const durationHours =
    durationMs / 3_600_000;

  /*
   * Every started hour counts as one billable hour.
   *
   * 00:01 -> 1 hour
   * 01:01 -> 2 hours
   * 02:01 -> 3 hours
   * 03:01 -> 4 hours
   * 04:01+ -> Day Pass
   */
  const billableHours =
    Math.max(
      1,
      Math.ceil(
        durationHours,
      ),
    );

  const ordersTotal =
    parseFloat(
      session.ordersTotal || "0",
    );

  const discount =
    parseFloat(
      session.discount || "0",
    );

  /*
   * Package sessions do not charge seat time.
   * Regular sessions use the real workspace pricing rules.
   */
  const seatCharge =
    session.billingMode ===
    "package"
      ? 0
      : calculateRegularSeatCharge(
          billableHours,
        );

  const currentTotal =
    Math.max(
      0,
      seatCharge +
        ordersTotal -
        discount,
    );

  return (
    <Link
      href={`/bookings/${session.id}`}
      className="group block"
    >
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm hover:shadow-lg hover:border-indigo-300 transition overflow-hidden">

        <div className="p-5">

          {/* CUSTOMER */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">

              <div className="flex items-center gap-2">

                <div className="w-11 h-11 rounded-2xl bg-indigo-100 grid place-items-center text-xl">
                  👤
                </div>

                <div className="min-w-0">
                  <h2 className="font-bold text-slate-900 truncate">
                    {session.customerName}
                  </h2>

                  {session.customerPhone && (
                    <p className="text-xs text-slate-500 truncate">
                      {session.customerPhone}
                    </p>
                  )}
                </div>

              </div>

            </div>

            <div className="flex flex-col items-end gap-1">

              <span className="shrink-0 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[11px] font-bold uppercase">
                Active
              </span>

              {session.billingMode ===
                "package" && (
                <span className="shrink-0 px-2.5 py-1 rounded-full bg-indigo-100 text-indigo-700 text-[11px] font-bold">
                  PACKAGE
                </span>
              )}

            </div>
          </div>

          {/* SESSION INFO */}
          <div className="grid grid-cols-2 gap-3 mt-5">

            <InfoBox
              label="Session"
              value={`#${session.id}`}
            />

            <InfoBox
              label="Access Code"
              value={
                session.accessCode ||
                "----"
              }
              mono
            />

            <InfoBox
              label="Started"
              value={formatTime(
                session.checkedInAt,
              )}
            />

            <InfoBox
              label="Duration"
              value={formatDuration(
                durationMs,
              )}
              mono
            />

          </div>

          {/* BILLING */}
          <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-200 p-4">

            {/* BILLING TYPE */}
            <div className="flex items-center justify-between">

              <span className="text-sm text-slate-500">
                Billing
              </span>

              <span
                className={`font-semibold ${
                  session.billingMode ===
                  "package"
                    ? "text-indigo-600"
                    : "text-slate-800"
                }`}
              >
                {session.billingMode ===
                "package"
                  ? "Package"
                  : "Regular"}
              </span>

            </div>

            {/* SEAT */}
            <div className="flex items-center justify-between mt-2">

              <span className="text-sm text-slate-500">
                Seat
              </span>

              <span className="font-semibold text-slate-800">
                {seatCharge.toFixed(2)}{" "}
                {currency}
              </span>

            </div>

            {/* HOURS / PACKAGE */}
            <div className="flex items-center justify-between mt-2">

              <span className="text-sm text-slate-500">
                {session.billingMode ===
                "package"
                  ? "Package time"
                  : billableHours > 4
                  ? "Day Pass"
                  : "Billable hours"}
              </span>

              <span className="font-semibold text-slate-800">
                {session.billingMode ===
                "package"
                  ? `${billableHours} ${
                      billableHours ===
                      1
                        ? "hour"
                        : "hours"
                    }`
                  : billableHours > 4
                  ? "150.00"
                  : `${billableHours} ${
                      billableHours ===
                      1
                        ? "hour"
                        : "hours"
                    }`}
              </span>

            </div>

            {/* F&B */}
            <div className="flex items-center justify-between mt-2">

              <span className="text-sm text-slate-500">
                F&amp;B
              </span>

              <span className="font-semibold text-slate-800">
                {ordersTotal.toFixed(
                  2,
                )}{" "}
                {currency}
              </span>

            </div>

            {/* DISCOUNT */}
            {discount > 0 && (
              <div className="flex items-center justify-between mt-2">

                <span className="text-sm text-slate-500">
                  Discount
                </span>

                <span className="font-semibold text-red-600">
                  -
                  {discount.toFixed(
                    2,
                  )}{" "}
                  {currency}
                </span>

              </div>
            )}

            {/* TOTAL */}
            <div className="border-t border-slate-200 mt-3 pt-3 flex items-center justify-between">

              <span className="font-bold text-slate-900">
                Current Total
              </span>

              <span className="text-lg font-bold text-indigo-600">
                {currentTotal.toFixed(
                  2,
                )}{" "}
                {currency}
              </span>

            </div>

          </div>

        </div>

        {/* FOOTER */}
        <div className="px-5 py-3 bg-slate-50 border-t border-slate-200">

          <div className="text-sm font-semibold text-indigo-600 group-hover:text-indigo-700">
            Open session →
          </div>

        </div>

      </div>
    </Link>
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
      hour: "2-digit",
      minute: "2-digit",
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
      (totalSeconds % 3600) /
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