"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useRouter } from "next/navigation";

import ConfirmDialog from "./ConfirmDialog";

type OrderItem = {
  id: number;
  name: string;
  unitPrice: string;
  quantity: number;
  createdAt: string;
};

type MenuCategory = {
  id: number;
  name: string;
  icon: string;
};

type MenuProduct = {
  id: number;
  categoryId: number;
  name: string;
  price: string;
  imageUrl: string | null;
  icon: string;
};

type ActiveSession = {
  reservationId: number;
  bookingId: number | null;
  roomId: number;
  roomName: string;
  customerId: number;
  customerName: string;
  customerPhone: string | null;
  customerBalance: number;
  connectedDevices: number;
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
  paymentMethod: "cash" | "visa" | "instapay" | "balance";
  discountAmount: string;
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
  categories,
  products,
}: {
  currency: string;
  categories: MenuCategory[];
  products: MenuProduct[];
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
  const [orderSession, setOrderSession] =
    useState<ActiveSession | null>(null);
  const [orderCategoryId, setOrderCategoryId] =
    useState<number | null>(null);
  const [orderSearch, setOrderSearch] = useState("");
  const [addingProductId, setAddingProductId] =
    useState<number | null>(null);
  const [orderError, setOrderError] =
    useState<string | null>(null);
  const [orderNotice, setOrderNotice] =
    useState<string | null>(null);
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
  const [cancellingId, setCancellingId] =
    useState<number | null>(null);

  const [pendingCancel, setPendingCancel] =
    useState<ActiveSession | null>(null);
  const [cancelError, setCancelError] =
    useState<string | null>(null);

  function cancelSession(session: ActiveSession) {
    if (cancellingId !== null) return;
    setCancelError(null);
    setPendingCancel(session);
  }

  async function confirmCancelSession() {
    const session = pendingCancel;
    if (!session || cancellingId !== null) return;
    setCancellingId(session.reservationId);
    setCancelError(null);
    try {
      const response = await fetch(
        `/api/meeting-rooms/reservations/${session.reservationId}`,
        { method: "DELETE" },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data?.error ||
            `Could not cancel the session (HTTP ${response.status}).`,
        );
      }
      setPendingCancel(null);
      await load();
      router.refresh();
    } catch (cancelFailure) {
      console.error("Meeting room cancel error:", cancelFailure);
      setCancelError(
        cancelFailure instanceof Error
          ? cancelFailure.message
          : "Could not cancel this session.",
      );
    } finally {
      setCancellingId(null);
    }
  }

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

  const filteredMenuProducts = useMemo(() => {
    const query = orderSearch.trim().toLocaleLowerCase();
    return products.filter((product) => {
      if (orderCategoryId !== null && product.categoryId !== orderCategoryId) {
        return false;
      }
      if (query && !product.name.toLocaleLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [products, orderCategoryId, orderSearch]);

  function openFnbOrder(session: ActiveSession) {
    setOrderSession(session);
    setOrderCategoryId(null);
    setOrderSearch("");
    setOrderError(null);
    setOrderNotice(null);
  }

  async function addProductToMeeting(product: MenuProduct) {
    const session = orderSession;
    if (!session || addingProductId !== null) return;

    if (!session.bookingId) {
      setOrderError("This meeting room is not linked to an active customer session, so items cannot be added to its bill.");
      return;
    }

    setAddingProductId(product.id);
    setOrderError(null);
    setOrderNotice(null);

    try {
      const response = await fetch(
        `/api/bookings/${session.bookingId}/items`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ productId: product.id, quantity: 1 }),
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data?.error || `Could not add ${product.name} (HTTP ${response.status}).`,
        );
      }

      setOrderNotice(`${product.name} added to ${session.roomName}'s bill.`);
      await load(true);
    } catch (addError) {
      console.error("Add meeting room F&B item error:", addError);
      setOrderError(
        addError instanceof Error
          ? addError.message
          : "Could not add this product to the meeting room bill.",
      );
    } finally {
      setAddingProductId(null);
    }
  }

  async function confirmCheckout() {
    if (!checkout) {
      return;
    }

    const baseTotal = Number(
      checkout.session.grandTotal,
    );
    const discountAmount = Number(
      checkout.discountAmount,
    );
    const total = baseTotal - discountAmount;
    const paid = Number(
      checkout.paidAmount,
    );

    if (
      !Number.isFinite(baseTotal) ||
      baseTotal < 0 ||
      !Number.isFinite(discountAmount) ||
      discountAmount < 0 ||
      discountAmount > baseTotal
    ) {
      setActionError(
        "Invalid discount or session total.",
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
            discountAmount,
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
    <section className="space-y-4 meeting-active-section">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="meeting-section-title-stack"><span className="meeting-section-kicker">LIVE OPERATIONS</span><h2 className="text-lg font-bold text-slate-900">In session</h2></div>
          <p className="text-sm text-slate-500 mt-0.5">
            Live room sessions, customer QR access and F&amp;B orders.
          </p>
        </div>

        <div className="rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-sm font-semibold text-emerald-700">
          {sessions.length} active
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
                className="meeting-active-room-card rounded-3xl border border-slate-200 bg-white shadow-sm overflow-hidden"
              >
                <div className="meeting-active-room-header p-5 border-b border-slate-100">
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
                      {new Date(session.endAt).getTime() < now && (
                        <span className="inline-block mt-2 text-xs font-bold text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">
                          ⚠️ Overdue — past the booked end time, check out
                          when the room is free
                        </span>
                      )}
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
                        Everyone in the meeting can scan the room QR and enter this
                        same code on their own phone. All orders go on this one
                        bill.
                      </div>
                      <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white border border-indigo-200 px-2.5 py-1 text-xs font-semibold text-indigo-800">
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            session.connectedDevices > 0
                              ? "bg-emerald-500"
                              : "bg-slate-300"
                          }`}
                        />
                        {session.connectedDevices}{" "}
                        {session.connectedDevices === 1
                          ? "device connected"
                          : "devices connected"}
                      </div>
                    </div>
                  )}

                  <div className="meeting-active-room-bill rounded-2xl border border-slate-200 p-4">
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

                  <div className="meeting-active-fnb-panel rounded-2xl border border-slate-200 overflow-hidden">
                    <div className="meeting-active-fnb-heading px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
                      <div>
                        <span className="font-bold text-slate-800">F&amp;B Orders</span>
                        <span className="ml-2 text-xs font-bold text-slate-500">
                          {session.itemCount} item(s)
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary px-3 py-2 text-sm"
                        onClick={() => openFnbOrder(session)}
                        disabled={checkingOut || adjusting || cancellingId !== null || !session.bookingId}
                        title={!session.bookingId ? "This session has no linked customer booking" : "Add food and drinks to this meeting room bill"}
                      >
                        ＋ Add food &amp; drinks
                      </button>
                    </div>

                    {session.items.length > 0 ? (
                      <div className="divide-y divide-slate-100">
                        {session.items.map((item) => (
                          <div
                            key={item.id}
                            className="px-4 py-3 flex items-center justify-between gap-4"
                          >
                            <div className="min-w-0">
                              <div className="font-semibold text-slate-800 truncate">{item.name}</div>
                              <div className="text-xs text-slate-500">
                                {item.quantity} × {money(item.unitPrice)} {currency}
                              </div>
                            </div>
                            <div className="font-bold tabular-nums text-slate-900">
                              {money(Number(item.unitPrice) * item.quantity)} {currency}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-4 text-sm text-slate-500">
                        No F&amp;B orders yet. Staff can add items here even when the customer does not use the QR menu.
                      </div>
                    )}
                  </div>

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
                        discountAmount: "0.00",
                        paidAmount: money(
                          session.grandTotal,
                        ),
                      });
                    }}
                    disabled={checkingOut || adjusting || cancellingId !== null}
                  >
                    💳 Checkout &amp; Close Session
                  </button>

                  <button
                    type="button"
                    className="btn btn-ghost w-full py-2 text-red-600"
                    onClick={() => void cancelSession(session)}
                    disabled={
                      checkingOut ||
                      adjusting ||
                      cancellingId !== null
                    }
                  >
                    {cancellingId === session.reservationId
                      ? "Cancelling…"
                      : "✕ Cancel session"}
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

      {orderSession && (
        <div
          className="fixed inset-0 z-[60] bg-slate-950/60 backdrop-blur-sm grid place-items-center p-3 sm:p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && addingProductId === null) {
              setOrderSession(null);
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="meeting-room-add-fnb-title"
            className="w-full max-w-5xl max-h-[92vh] rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col"
          >
            <div className="p-5 sm:p-6 border-b border-slate-100 bg-gradient-to-r from-indigo-50 via-white to-cyan-50">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.16em] text-indigo-600 font-bold">
                    Staff order · Meeting room
                  </div>
                  <h3 id="meeting-room-add-fnb-title" className="text-2xl font-black text-slate-900 mt-1">
                    Add food &amp; drinks
                  </h3>
                  <p className="text-sm text-slate-600 mt-1">
                    {orderSession.roomName} · {orderSession.customerName}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Items go straight onto this active session&apos;s bill; the customer does not need to scan the QR code.
                  </p>
                </div>
                <button
                  type="button"
                  className="w-10 h-10 shrink-0 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 font-bold"
                  onClick={() => addingProductId === null && setOrderSession(null)}
                  disabled={addingProductId !== null}
                  aria-label="Close add food and drinks"
                >
                  ✕
                </button>
              </div>
              <div className="mt-4">
                <input
                  type="search"
                  value={orderSearch}
                  onChange={(event) => setOrderSearch(event.target.value)}
                  placeholder="Search drinks and food…"
                  className="input w-full bg-white"
                  aria-label="Search menu products"
                  autoFocus
                />
              </div>
              {categories.length > 0 && (
                <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                  <button
                    type="button"
                    onClick={() => setOrderCategoryId(null)}
                    className={`rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap transition ${
                      orderCategoryId === null
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "bg-white border border-slate-200 text-slate-700 hover:border-indigo-300"
                    }`}
                  >
                    All items
                  </button>
                  {categories.map((category) => (
                    <button
                      type="button"
                      key={category.id}
                      onClick={() => setOrderCategoryId(category.id)}
                      className={`rounded-full px-4 py-2 text-sm font-semibold whitespace-nowrap transition ${
                        orderCategoryId === category.id
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "bg-white border border-slate-200 text-slate-700 hover:border-indigo-300"
                      }`}
                    >
                      <span className="mr-1">{category.icon}</span>{category.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto min-h-0">
              {orderError && (
                <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  {orderError}
                </div>
              )}
              {orderNotice && (
                <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
                  ✓ {orderNotice} You can add more items or close this window.
                </div>
              )}

              {filteredMenuProducts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
                  {products.length === 0
                    ? "No active menu products are available. Add products in Menu & F&B first."
                    : "No products match this search or category."}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {filteredMenuProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => void addProductToMeeting(product)}
                      disabled={addingProductId !== null || !orderSession.bookingId}
                      className="group min-w-0 rounded-2xl border border-slate-200 bg-white overflow-hidden text-left transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg disabled:opacity-60 disabled:cursor-wait"
                    >
                      <div className="relative h-28 sm:h-32 bg-slate-100 flex items-center justify-center overflow-hidden">
                        {product.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-5xl" aria-hidden="true">{product.icon || "☕"}</span>
                        )}
                        <span className="absolute right-2 top-2 rounded-lg bg-white/95 px-2 py-1 text-lg shadow-sm" aria-hidden="true">
                          {product.icon || "☕"}
                        </span>
                      </div>
                      <div className="p-3">
                        <div className="font-bold text-sm text-slate-900 truncate" title={product.name}>{product.name}</div>
                        <div className="mt-1 text-sm font-extrabold text-indigo-700 tabular-nums">
                          {money(product.price)} {currency}
                        </div>
                        <div className="mt-3 rounded-xl bg-indigo-50 px-3 py-2 text-center text-xs font-bold text-indigo-700 group-hover:bg-indigo-600 group-hover:text-white transition">
                          {addingProductId === product.id ? "Adding…" : "+ Add 1"}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 p-4 sm:px-6 flex items-center justify-between gap-3 bg-slate-50">
              <div className="text-xs text-slate-500">
                Added items appear in F&amp;B Orders and are included in the meeting-room checkout total.
              </div>
              <button
                type="button"
                className="btn btn-ghost shrink-0"
                onClick={() => addingProductId === null && setOrderSession(null)}
                disabled={addingProductId !== null}
              >
                Done
              </button>
            </div>
          </div>
        </div>
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
                <Row
                  label="Subtotal"
                  value={`${money(checkout.session.grandTotal)} ${currency}`}
                />
                <Row
                  label="Discount"
                  value={`${money(checkout.discountAmount)} ${currency}`}
                />
                <div className="border-t border-slate-200 pt-2">
                  <Row
                    label="Total"
                    value={`${money(
                      Math.max(
                        0,
                        Number(checkout.session.grandTotal) -
                          Number(checkout.discountAmount || 0),
                      ),
                    )} ${currency}`}
                    strong
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Payment method
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {([
                    ["cash", "Cash"],
                    ["visa", "Visa"],
                    ["instapay", "InstaPay"],
                    [
                      "balance",
                      `Balance · ${checkout.session.customerBalance.toFixed(2)}`,
                    ],
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
                  htmlFor="meeting-room-discount"
                  className="block text-sm font-semibold text-slate-700 mb-2"
                >
                  Discount
                </label>
                <input
                  id="meeting-room-discount"
                  className="input w-full text-lg font-bold"
                  type="number"
                  min="0"
                  step="0.01"
                  max={Number(checkout.session.grandTotal).toFixed(2)}
                  value={checkout.discountAmount}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCheckout((current) =>
                      current
                        ? {
                            ...current,
                            discountAmount: value,
                            paidAmount: money(
                              Math.max(
                                0,
                                Number(current.session.grandTotal) -
                                  Math.max(0, Number(value) || 0),
                              ),
                            ),
                          }
                        : null,
                    );
                  }}
                  disabled={checkingOut}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Additional manual discount for this checkout.
                </p>
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
                  const subtotalAmount = Number(
                    checkout.session.grandTotal,
                  );
                  const discountAmount = Number(
                    checkout.discountAmount,
                  );
                  const totalAmount = Math.max(
                    0,
                    subtotalAmount -
                      (Number.isFinite(discountAmount)
                        ? Math.max(0, discountAmount)
                        : 0),
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

      {pendingCancel && (
        <ConfirmDialog
          title="Cancel this session?"
          message={
            <>
              <b>{pendingCancel.customerName}</b> · {pendingCancel.roomName}
              <br />
              The room is freed immediately and nothing is charged. Package
              hours (if used) go back to the customer. This can&apos;t be
              undone.
            </>
          }
          confirmLabel="Cancel session"
          busy={cancellingId !== null}
          error={cancelError}
          onConfirm={() => void confirmCancelSession()}
          onClose={() => cancellingId === null && setPendingCancel(null)}
        />
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
