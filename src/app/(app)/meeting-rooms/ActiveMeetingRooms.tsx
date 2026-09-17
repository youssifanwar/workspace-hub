"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useRouter } from "next/navigation";

type OrderItem = {
  id: number;
  name: string;
  unitPrice: string;
  quantity: number;
  createdAt: string;
};

type ActiveSession = {
  reservationId: number;
  bookingId: number | null;
  roomId: number;
  roomName: string;
  customerId: number;
  customerName: string;
  customerPhone: string | null;
  accessCode: string | null;
  startAt: string;
  endAt: string;
  attendeeCount: number;
  durationHours: number;
  hourlyRate: string;
  roomSubtotal: string;
  roomDiscount: string;
  roomTotal: string;
  fnbTotal: string;
  grandTotal: string;
  itemCount: number;
  items: OrderItem[];
  packagePurchaseId: number | null;
  status: string;
  notes: string | null;
};

type CheckoutState = {
  session: ActiveSession;
  paymentMethod: "cash" | "visa" | "instapay";
  paidAmount: string;
};

type AdjustmentState = {
  session: ActiveSession;
  mode: "people" | "hours";
  amount: string;
};

function money(
  value: number | string,
): string {
  const amount =
    typeof value === "number"
      ? value
      : Number(value);

  return Number.isFinite(amount)
    ? amount.toFixed(2)
    : "0.00";
}

function formatElapsed(
  startAt: string,
  now: number,
): string {
  const started = new Date(startAt).getTime();

  if (!Number.isFinite(started)) {
    return "0m";
  }

  const seconds = Math.max(
    0,
    Math.floor((now - started) / 1000),
  );
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(
    (seconds % 3600) / 60,
  );

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

export default function ActiveMeetingRooms({
  currency,
}: {
  currency: string;
}) {
  const router = useRouter();

  const [sessions, setSessions] =
    useState<ActiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] =
    useState<string | null>(null);
  const [now, setNow] =
    useState(() => Date.now());
  const [checkout, setCheckout] =
    useState<CheckoutState | null>(null);
  const [checkingOut, setCheckingOut] =
    useState(false);
  const [actionError, setActionError] =
    useState<string | null>(null);
  const [adjustment, setAdjustment] =
    useState<AdjustmentState | null>(null);
  const [adjusting, setAdjusting] =
    useState(false);
  const [adjustmentError, setAdjustmentError] =
    useState<string | null>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      }

      try {
        const response = await fetch(
          "/api/meeting-rooms/active",
          {
            method: "GET",
            cache: "no-store",
            headers: {
              Accept: "application/json",
            },
          },
        );

        const data = await response
          .json()
          .catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            data?.error ||
              `Could not load active meeting rooms (HTTP ${response.status}).`,
          );
        }

        setSessions(
          Array.isArray(data?.sessions)
            ? (data.sessions as ActiveSession[])
            : [],
        );
        setError(null);
      } catch (loadError) {
        console.error(
          "Load active meeting rooms error:",
          loadError,
        );

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Could not load active meeting room sessions.",
        );
      } finally {
        if (!silent) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    void load();

    const refreshTimer = window.setInterval(
      () => void load(true),
      5000,
    );

    return () =>
      window.clearInterval(refreshTimer);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Date.now()),
      1000,
    );

    return () =>
      window.clearInterval(timer);
  }, []);

  const hasOrders = useMemo(
    () =>
      sessions.some(
        (session) => session.items.length > 0,
      ),
    [sessions],
  );

  async function confirmCheckout() {
    if (!checkout) {
      return;
    }

    const total = Number(
      checkout.session.grandTotal,
    );
    const paid = Number(
      checkout.paidAmount,
    );

    if (!Number.isFinite(total) || total < 0) {
      setActionError(
        "Invalid session total.",
      );
      return;
    }

    if (
      !Number.isFinite(paid) ||
      paid < total
    ) {
      setActionError(
        `Paid amount must be at least ${money(total)} ${currency}.`,
      );
      return;
    }

    setCheckingOut(true);
    setActionError(null);

    try {
      const response = await fetch(
        `/api/meeting-rooms/reservations/${checkout.session.reservationId}/checkout`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            paymentMethod:
              checkout.paymentMethod,
            paidAmount: paid,
          }),
        },
      );

      const data = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data?.error ||
            `Checkout failed (HTTP ${response.status}).`,
        );
      }

      setCheckout(null);
      setSessions((current) =>
        current.filter(
          (session) =>
            session.reservationId !==
            checkout.session.reservationId,
        ),
      );

      const invoiceUrl =
        typeof data?.invoiceUrl === "string"
          ? data.invoiceUrl
          : null;

      if (invoiceUrl) {
        router.push(invoiceUrl);
        return;
      }

      router.refresh();
    } catch (checkoutError) {
      console.error(
        "Meeting room checkout error:",
        checkoutError,
      );

      setActionError(
        checkoutError instanceof Error
          ? checkoutError.message
          : "Could not complete meeting room checkout.",
      );
    } finally {
      setCheckingOut(false);
    }
  }

  async function confirmAdjustment() {
    if (!adjustment || adjusting) {
      return;
    }

    const amount = Number(adjustment.amount);

    if (!Number.isSafeInteger(amount) || amount <= 0) {
      setAdjustmentError("Enter a positive whole number.");
      return;
    }

    if (
      adjustment.mode === "people" &&
      amount <= 0
    ) {
      setAdjustmentError("Enter at least 1 additional person.");
      return;
    }

    if (
      adjustment.mode === "hours" &&
      amount <= 0
    ) {
      setAdjustmentError("Enter at least 1 additional hour.");
      return;
    }

    setAdjusting(true);
    setAdjustmentError(null);

    try {
      const response = await fetch(
        `/api/meeting-rooms/reservations/${adjustment.session.reservationId}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            action:
              adjustment.mode === "people"
                ? "add_people"
                : "add_hours",
            amount,
          }),
        },
      );

      const data = await response
        .json()
        .catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          data?.error ||
            `Could not adjust the session (HTTP ${response.status}).`,
        );
      }

      setAdjustment(null);
      setAdjustmentError(null);
      await load();
      router.refresh();
    } catch (adjustmentActionError) {
      console.error(
        "Meeting room session adjustment error:",
        adjustmentActionError,
      );
      setAdjustmentError(
        adjustmentActionError instanceof Error
          ? adjustmentActionError.message
          : "Could not adjust the meeting room session.",
      );
    } finally {
      setAdjusting(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">
            Active Meeting Rooms
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            Live room sessions, customer QR access and F&amp;B orders.
          </p>
        </div>

        <div className="rounded-full bg-emerald-100 px-4 py-2 text-sm font-bold text-emerald-800">
          Active {sessions.length}
        </div>
      </div>

      {loading && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Loading active meeting rooms...
        </div>
      )}

      {error && !loading && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-slate-300 bg-white p-8 text-center text-slate-500">
          No active meeting room sessions.
        </div>
      )}

      {!loading && !error && sessions.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {sessions.map((session) => {
            const total = Number(
              session.grandTotal,
            );

            return (
              <div
                key={session.reservationId}
                className="rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden"
              >
                <div className="p-5 border-b border-slate-100">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs uppercase tracking-wide text-indigo-600 font-bold">
                        Meeting Room
                      </div>
                      <h3 className="text-xl font-black text-slate-900 mt-1">
                        {session.roomName}
                      </h3>
                      <p className="text-sm text-slate-500 mt-1">
                        {session.customerName}
                        {session.customerPhone
                          ? ` · ${session.customerPhone}`
                          : ""}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-emerald-50 px-3 py-2 text-right">
                      <div className="text-[11px] uppercase font-bold text-emerald-700">
                        Elapsed
                      </div>
                      <div className="text-lg font-black text-emerald-900 tabular-nums">
                        {formatElapsed(
                          session.startAt,
                          now,
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                    <Info
                      label="People"
                      value={String(
                        session.attendeeCount,
                      )}
                    />
                    <Info
                      label="Planned"
                      value={`${session.durationHours}h`}
                    />
                    <Info
                      label="Ends"
                      value={new Date(
                        session.endAt,
                      ).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    />
                    <Info
                      label="QR Code"
                      value={
                        session.accessCode ||
                        "—"
                      }
                    />
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  {session.accessCode && (
                    <div className="rounded-2xl bg-indigo-50 border border-indigo-100 p-4">
                      <div className="text-xs uppercase tracking-wide text-indigo-700 font-bold">
                        Customer QR access code
                      </div>
                      <div className="text-3xl font-black tracking-[0.25em] text-indigo-900 mt-1">
                        {session.accessCode}
                      </div>
                      <div className="text-xs text-indigo-700 mt-1">
                        Customer scans the room QR, then enters this 4-digit code once.
                      </div>
                    </div>
                  )}

                  <div className="rounded-2xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between font-semibold">
                      <span className="text-slate-600">
                        Room
                      </span>
                      <span className="tabular-nums">
                        {money(
                          session.roomTotal,
                        )} {currency}
                      </span>
                    </div>

                    <div className="flex items-center justify-between mt-2 font-semibold">
                      <span className="text-slate-600">
                        F&amp;B
                      </span>
                      <span className="tabular-nums">
                        {money(
                          session.fnbTotal,
                        )} {currency}
                      </span>
                    </div>

                    <div className="border-t border-slate-100 mt-3 pt-3 flex items-center justify-between text-lg font-black">
                      <span>Total</span>
                      <span className="text-indigo-700 tabular-nums">
                        {money(total)} {currency}
                      </span>
                    </div>
                  </div>

                  {session.items.length > 0 ? (
                    <div className="rounded-2xl border border-slate-200 overflow-hidden">
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
                        <span className="font-bold text-slate-800">
                          F&amp;B Orders
                        </span>
                        <span className="text-xs font-bold text-slate-500">
                          {session.itemCount} item(s)
                        </span>
                      </div>

                      <div className="divide-y divide-slate-100">
                        {session.items.map(
                          (item) => (
                            <div
                              key={item.id}
                              className="px-4 py-3 flex items-center justify-between gap-4"
                            >
                              <div className="min-w-0">
                                <div className="font-semibold text-slate-800 truncate">
                                  {item.name}
                                </div>
                                <div className="text-xs text-slate-500">
                                  {item.quantity} × {money(item.unitPrice)} {currency}
                                </div>
                              </div>

                              <div className="font-bold tabular-nums text-slate-900">
                                {money(
                                  Number(item.unitPrice) *
                                    item.quantity,
                                )} {currency}
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
                      No F&amp;B orders yet.
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="btn btn-ghost border border-slate-200 py-3"
                      onClick={() => {
                        setAdjustmentError(null);
                        setAdjustment({
                          session,
                          mode: "people",
                          amount: "1",
                        });
                      }}
                      disabled={checkingOut || adjusting}
                    >
                      👥 Add People
                    </button>

                    <button
                      type="button"
                      className="btn btn-ghost border border-slate-200 py-3"
                      onClick={() => {
                        setAdjustmentError(null);
                        setAdjustment({
                          session,
                          mode: "hours",
                          amount: "1",
                        });
                      }}
                      disabled={checkingOut || adjusting}
                    >
                      ⏱️ Add Time
                    </button>
                  </div>

                  <button
                    type="button"
                    className="btn btn-primary w-full py-3"
                    onClick={() => {
                      setActionError(null);
                      setCheckout({
                        session,
                        paymentMethod: "cash",
                        paidAmount: money(
                          session.grandTotal,
                        ),
                      });
                    }}
                    disabled={checkingOut || adjusting}
                  >
                    💳 Checkout &amp; Close Session
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasOrders && (
        <p className="text-xs text-slate-500">
          F&amp;B orders are linked to the same customer booking used by this meeting room session.
        </p>
      )}

      {adjustment && (
        <div className="fixed inset-0 z-[55] bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <div className="text-xs uppercase tracking-wide text-indigo-600 font-bold">
                Adjust Active Session
              </div>
              <h3 className="text-2xl font-black text-slate-900 mt-1">
                {adjustment.session.roomName}
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                {adjustment.session.customerName}
              </p>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Info
                  label="Current People"
                  value={String(adjustment.session.attendeeCount)}
                />
                <Info
                  label="Current Time"
                  value={`${adjustment.session.durationHours}h`}
                />
              </div>

              <div>
                <label
                  htmlFor="meeting-room-adjustment"
                  className="block text-sm font-semibold text-slate-700 mb-2"
                >
                  {adjustment.mode === "people"
                    ? "Additional people"
                    : "Additional hours"}
                </label>
                <input
                  id="meeting-room-adjustment"
                  className="input w-full text-lg font-bold"
                  type="number"
                  min="1"
                  step="1"
                  value={adjustment.amount}
                  disabled={adjusting}
                  onChange={(event) =>
                    setAdjustment((current) =>
                      current
                        ? {
                            ...current,
                            amount: event.target.value,
                          }
                        : null,
                    )
                  }
                  autoFocus
                />
              </div>

              {(() => {
                const amount = Number(adjustment.amount);
                const validAmount = Number.isSafeInteger(amount) && amount > 0
                  ? amount
                  : 0;

                const newPeople =
                  adjustment.mode === "people"
                    ? adjustment.session.attendeeCount + validAmount
                    : adjustment.session.attendeeCount;

                const newHours =
                  adjustment.mode === "hours"
                    ? adjustment.session.durationHours + validAmount
                    : adjustment.session.durationHours;

                return (
                  <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4 space-y-2">
                    <Row
                      label="New People"
                      value={String(newPeople)}
                    />
                    <Row
                      label="New Duration"
                      value={`${newHours}h`}
                    />
                    <div className="border-t border-slate-200 pt-2 text-sm text-slate-500">
                      The server will recalculate the room pricing tier and total before saving.
                    </div>
                  </div>
                );
              })()}

              {adjustmentError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {adjustmentError}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-slate-100 flex gap-3 justify-end">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  if (!adjusting) {
                    setAdjustment(null);
                    setAdjustmentError(null);
                  }
                }}
                disabled={adjusting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void confirmAdjustment()}
                disabled={adjusting}
              >
                {adjusting
                  ? "Saving..."
                  : adjustment.mode === "people"
                    ? "Add People"
                    : "Add Time"}
              </button>
            </div>
          </div>
        </div>
      )}

      {checkout && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-5 border-b border-slate-100">
              <div className="text-xs uppercase tracking-wide text-indigo-600 font-bold">
                Checkout
              </div>
              <h3 className="text-2xl font-black text-slate-900 mt-1">
                {checkout.session.roomName}
              </h3>
              <p className="text-sm text-slate-500 mt-1">
                {checkout.session.customerName}
              </p>
            </div>

            <div className="p-5 space-y-4">
              <div className="rounded-2xl bg-slate-50 p-4 space-y-2">
                <Row
                  label="Room"
                  value={`${money(checkout.session.roomTotal)} ${currency}`}
                />
                <Row
                  label="F&B"
                  value={`${money(checkout.session.fnbTotal)} ${currency}`}
                />
                <div className="border-t border-slate-200 pt-2">
                  <Row
                    label="Total"
                    value={`${money(checkout.session.grandTotal)} ${currency}`}
                    strong
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Payment method
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    ["cash", "Cash"],
                    ["visa", "Visa"],
                    ["instapay", "InstaPay"],
                  ] as const).map(
                    ([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        className={`rounded-xl border px-3 py-3 text-sm font-bold transition ${
                          checkout.paymentMethod ===
                          value
                            ? "border-indigo-500 bg-indigo-50 text-indigo-800"
                            : "border-slate-200 hover:border-slate-300"
                        }`}
                        onClick={() =>
                          setCheckout(
                            (current) =>
                              current
                                ? {
                                    ...current,
                                    paymentMethod:
                                      value,
                                  }
                                : null,
                          )
                        }
                      >
                        {label}
                      </button>
                    ),
                  )}
                </div>
              </div>

              <div>
                <label
                  htmlFor="meeting-room-paid"
                  className="block text-sm font-semibold text-slate-700 mb-2"
                >
                  Paid amount
                </label>
                <input
                  id="meeting-room-paid"
                  className="input w-full text-lg font-bold"
                  type="number"
                  min="0"
                  step="0.01"
                  value={checkout.paidAmount}
                  onChange={(event) =>
                    setCheckout(
                      (current) =>
                        current
                          ? {
                              ...current,
                              paidAmount:
                                event.target.value,
                            }
                          : null,
                    )
                  }
                />

                {(() => {
                  const paidAmount = Number(
                    checkout.paidAmount,
                  );
                  const totalAmount = Number(
                    checkout.session.grandTotal,
                  );
                  const validPaid = Number.isFinite(
                    paidAmount,
                  )
                    ? paidAmount
                    : 0;
                  const change = Math.max(
                    0,
                    validPaid - totalAmount,
                  );
                  const due = Math.max(
                    0,
                    totalAmount - validPaid,
                  );

                  return (
                    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                      <Row
                        label="Remaining"
                        value={`${money(due)} ${currency}`}
                      />
                      <div className="border-t border-slate-200 pt-2">
                        <Row
                          label="Change"
                          value={`${money(
                            checkout.paymentMethod === "cash"
                              ? change
                              : 0,
                          )} ${currency}`}
                          strong
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>

              {actionError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {actionError}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-slate-100 flex gap-3 justify-end">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  if (!checkingOut) {
                    setCheckout(null);
                    setActionError(null);
                  }
                }}
                disabled={checkingOut}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  void confirmCheckout()
                }
                disabled={checkingOut}
              >
                {checkingOut
                  ? "Closing..."
                  : "Confirm Checkout"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-[11px] uppercase font-bold text-slate-500">
        {label}
      </div>
      <div className="mt-1 font-bold text-slate-800 tabular-nums truncate">
        {value}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-4 ${
        strong
          ? "text-lg font-black"
          : "text-sm font-semibold"
      }`}
    >
      <span className="text-slate-600">
        {label}
      </span>
      <span className="tabular-nums text-slate-900">
        {value}
      </span>
    </div>
  );
}
