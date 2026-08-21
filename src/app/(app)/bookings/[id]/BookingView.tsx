"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Booking = {
  id: number;
  customerName: string;
  customerPhone: string;
  deskName: string;
  deskType: "desk" | "meeting_room";
  checkedInAt: string;
  hourlyRate: string;
  ordersTotal: string;
  discount: string;
};

type Item = {
  id: number;
  name: string;
  unitPrice: string;
  quantity: number;
};

type GroupedItem = Item & {
  itemIds: number[];
};

type Category = {
  id: number;
  name: string;
  icon: string;
};

type Product = {
  id: number;
  categoryId: number;
  name: string;
  price: string;
  imageUrl: string | null;
  icon: string;
};

export default function BookingView({
  booking,
  items: initialItems,
  categories,
  products,
  currency,
}: {
  booking: Booking;
  items: Item[];
  categories: Category[];
  products: Product[];
  currency: string;
}) {
  const router = useRouter();

  const [items, setItems] =
    useState<Item[]>(initialItems);

  const [activeCat, setActiveCat] =
    useState<number | null>(
      categories[0]?.id ?? null,
    );

  const [now, setNow] =
    useState<Date>(new Date());

  const [busy, setBusy] =
    useState(false);

  const [checkoutOpen, setCheckoutOpen] =
    useState(false);

  const [discount, setDiscount] =
    useState(booking.discount);

  // ---------------------------------------------------------------------------
  // TIMER
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const t = setInterval(
      () => setNow(new Date()),
      1000,
    );

    return () => clearInterval(t);
  }, []);

  const startedAt =
    new Date(booking.checkedInAt);

  const durationMs = Math.max(
    0,
    now.getTime() -
      startedAt.getTime(),
  );

  const durationH =
    durationMs / 3_600_000;

  // IMPORTANT:
  // Every started hour is billed as a full hour.
  //
  // 00:01 -> 1 hour
  // 00:59 -> 1 hour
  // 01:01 -> 2 hours
  // 01:59 -> 2 hours
  //
  // A booking must always cost at least one hour.
  const billableHours = Math.max(
    1,
    Math.ceil(durationH),
  );

  const seatCharge =
    billableHours *
    parseFloat(booking.hourlyRate);

  // ---------------------------------------------------------------------------
  // GROUP SIMILAR ITEMS
  // ---------------------------------------------------------------------------

  const groupedItems =
    useMemo<GroupedItem[]>(() => {
      const groups =
        new Map<string, GroupedItem>();

      for (const item of items) {
        const normalizedName =
          item.name.trim().toLowerCase();

        const normalizedPrice =
          parseFloat(
            item.unitPrice,
          ).toFixed(2);

        const key =
          `${normalizedName}__${normalizedPrice}`;

        const existing =
          groups.get(key);

        if (existing) {
          existing.quantity +=
            item.quantity;

          existing.itemIds.push(
            item.id,
          );
        } else {
          groups.set(key, {
            ...item,
            itemIds: [item.id],
          });
        }
      }

      return Array.from(
        groups.values(),
      );
    }, [items]);

  // ---------------------------------------------------------------------------
  // ORDER TOTAL
  // ---------------------------------------------------------------------------

  const ordersTotal =
    groupedItems.reduce(
      (sum, item) =>
        sum +
        item.quantity *
          parseFloat(
            item.unitPrice,
          ),
      0,
    );

  const discountAmt =
    parseFloat(
      discount || "0",
    ) || 0;

  const total = Math.max(
    0,
    seatCharge +
      ordersTotal -
      discountAmt,
  );

  // ---------------------------------------------------------------------------
  // FILTER PRODUCTS
  // ---------------------------------------------------------------------------

  const filteredProducts =
    useMemo(
      () =>
        products.filter(
          (p) =>
            activeCat
              ? p.categoryId ===
                activeCat
              : true,
        ),
      [products, activeCat],
    );

  // ---------------------------------------------------------------------------
  // ADD PRODUCT
  // ---------------------------------------------------------------------------

  async function addProduct(
    p: Product,
  ) {
    setBusy(true);

    try {
      const res =
        await fetch(
          `/api/bookings/${booking.id}/items`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              productId: p.id,
              quantity: 1,
            }),
          },
        );

      if (res.ok) {
        const data =
          (await res.json()) as {
            item: Item;
          };

        setItems((prev) => {
          const existing =
            prev.find(
              (i) =>
                i.name ===
                  data.item.name &&
                parseFloat(
                  i.unitPrice,
                ) ===
                  parseFloat(
                    data.item
                      .unitPrice,
                  ),
            );

          if (existing) {
            return prev.map(
              (i) =>
                i.id ===
                  existing.id
                  ? {
                      ...i,
                      quantity:
                        i.quantity +
                        data.item
                          .quantity,
                    }
                  : i,
            );
          }

          return [
            ...prev,
            data.item,
          ];
        });
      }
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // UPDATE REAL DATABASE ITEM
  // ---------------------------------------------------------------------------

  async function updateItem(
    id: number,
    quantity: number,
  ) {
    setBusy(true);

    try {
      if (quantity <= 0) {
        const res =
          await fetch(
            `/api/bookings/${booking.id}/items?itemId=${id}`,
            {
              method: "DELETE",
            },
          );

        if (res.ok) {
          setItems((prev) =>
            prev.filter(
              (i) => i.id !== id,
            ),
          );
        }
      } else {
        const res =
          await fetch(
            `/api/bookings/${booking.id}/items`,
            {
              method: "PATCH",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                itemId: id,
                quantity,
              }),
            },
          );

        if (res.ok) {
          setItems((prev) =>
            prev.map((i) =>
              i.id === id
                ? {
                    ...i,
                    quantity,
                  }
                : i,
            ),
          );
        }
      }
    } finally {
      setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // UPDATE GROUPED ITEM
  // ---------------------------------------------------------------------------

  async function updateGroupedItem(
    item: GroupedItem,
    quantity: number,
  ) {
    await updateItem(
      item.id,
      quantity,
    );
  }

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  return (
    <div className="grid lg:grid-cols-[1fr_400px] gap-6">

      {/* LEFT: PRODUCTS */}
      <div className="space-y-4">

        {/* CURRENT BOOKING */}
        <div className="card p-4 flex items-center justify-between flex-wrap gap-3">

          <div>
            <div className="text-xs uppercase text-slate-500 font-semibold">
              Currently seated
            </div>

            <div className="flex items-center gap-3 mt-1">

              <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center font-bold">
                {booking.customerName
                  .charAt(0)
                  .toUpperCase()}
              </div>

              <div>
                <div className="font-bold">
                  {booking.customerName}
                </div>

                <div className="text-xs text-slate-500">
                  📞{" "}
                  {booking.customerPhone}
                  {" · "}
                  🪑{" "}
                  {booking.deskName}
                </div>
              </div>

            </div>
          </div>

          <div className="text-right">

            <div className="text-xs uppercase text-slate-500 font-semibold">
              Time
            </div>

            <div className="text-2xl font-bold tabular-nums">
              {formatDur(
                durationMs,
              )}
            </div>

            <div className="text-xs text-slate-500">
              @{" "}
              {parseFloat(
                booking.hourlyRate,
              ).toFixed(2)}{" "}
              {currency}/h
            </div>

            <div className="text-xs font-semibold text-indigo-600 mt-1">
              Billed: {billableHours}{" "}
              {billableHours === 1
                ? "hour"
                : "hours"}
            </div>

          </div>
        </div>

        {/* CATEGORIES */}
        <div className="flex gap-2 overflow-x-auto scroll-fade pb-1">

          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() =>
                setActiveCat(
                  c.id,
                )
              }
              className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition ${
                activeCat === c.id
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/30"
                  : "bg-white border border-slate-200 text-slate-700 hover:border-indigo-300"
              }`}
            >
              <span className="mr-1">
                {c.icon}
              </span>

              {c.name}
            </button>
          ))}

        </div>

        {/* PRODUCTS */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">

          {filteredProducts.length ===
            0 && (
            <div className="col-span-full text-center py-10 text-slate-400 text-sm">
              No products in this category
            </div>
          )}

          {filteredProducts.map(
            (p) => (
              <button
                key={p.id}
                onClick={() =>
                  addProduct(p)
                }
                disabled={busy}
                className="group aspect-square rounded-2xl bg-white border border-slate-200 hover:border-indigo-400 hover:-translate-y-0.5 transition overflow-hidden text-left flex flex-col"
              >

                <div className="flex-1 bg-slate-100 relative overflow-hidden">

                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-5xl">
                      {p.icon}
                    </div>
                  )}

                  <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/95 text-lg grid place-items-center shadow">
                    {p.icon}
                  </div>

                </div>

                <div className="p-2.5">

                  <div className="font-semibold text-sm text-slate-800 truncate">
                    {p.name}
                  </div>

                  <div className="text-xs text-indigo-600 font-bold">
                    {parseFloat(
                      p.price,
                    ).toFixed(2)}{" "}
                    {currency}
                  </div>

                </div>

              </button>
            ),
          )}

        </div>
      </div>

      {/* RIGHT: BILL */}
      <div className="space-y-4 lg:sticky lg:top-24 lg:self-start">

        <div className="card p-5">

          <h3 className="font-bold mb-3">
            Bill
          </h3>

          <div className="max-h-64 overflow-y-auto scroll-fade divide-soft">

            {groupedItems.length ===
            0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">
                🛒 No items yet
              </div>
            ) : (
              groupedItems.map(
                (item) => (
                  <div
                    key={`${item.name}-${item.unitPrice}`}
                    className="py-2 flex items-center gap-2"
                  >

                    <div className="flex-1 min-w-0">

                      <div className="font-semibold text-sm truncate">
                        {item.name}
                      </div>

                      <div className="text-xs text-slate-500">
                        {parseFloat(
                          item.unitPrice,
                        ).toFixed(2)}
                        {" × "}
                        {item.quantity}
                      </div>

                    </div>

                    <div className="flex items-center gap-1">

                      <button
                        onClick={() =>
                          updateGroupedItem(
                            item,
                            item.quantity -
                              1,
                          )
                        }
                        disabled={busy}
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold disabled:opacity-50"
                      >
                        −
                      </button>

                      <span className="w-6 text-center font-bold tabular-nums">
                        {item.quantity}
                      </span>

                      <button
                        onClick={() =>
                          updateGroupedItem(
                            item,
                            item.quantity +
                              1,
                          )
                        }
                        disabled={busy}
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold disabled:opacity-50"
                      >
                        +
                      </button>

                    </div>

                    <div className="w-16 text-right font-bold text-sm tabular-nums">
                      {(
                        item.quantity *
                        parseFloat(
                          item.unitPrice,
                        )
                      ).toFixed(2)}
                    </div>

                  </div>
                ),
              )
            )}

          </div>

          {/* TOTALS */}
          <div className="border-t border-slate-100 mt-3 pt-3 space-y-1.5 text-sm">

            <Row
              label="Seat charge"
              value={`${seatCharge.toFixed(
                2,
              )} ${currency}`}
            />

            <Row
              label="Billable hours"
              value={`${billableHours} ${
                billableHours === 1
                  ? "hour"
                  : "hours"
              }`}
            />

            <Row
              label="F&B"
              value={`${ordersTotal.toFixed(
                2,
              )} ${currency}`}
            />

            <div className="flex items-center justify-between">

              <span className="text-slate-600">
                Discount
              </span>

              <input
                type="number"
                className="w-24 px-2 py-1 rounded-lg border border-slate-200 text-right text-sm"
                value={discount}
                min="0"
                step="0.01"
                onChange={(e) =>
                  setDiscount(
                    e.target.value,
                  )
                }
              />

            </div>

            <div className="border-t border-slate-100 pt-2 flex items-center justify-between text-lg font-bold">

              <span>
                Total
              </span>

              <span className="tabular-nums text-indigo-700">
                {total.toFixed(2)}{" "}
                {currency}
              </span>

            </div>

          </div>

          {/* CHECKOUT */}
          <button
            onClick={() =>
              setCheckoutOpen(
                true,
              )
            }
            disabled={busy}
            className="btn btn-primary w-full mt-4 py-3"
          >
            💳 Checkout
          </button>

        </div>

        {/* CANCEL BOOKING */}
        <button
          onClick={async () => {
            if (
              !confirm(
                "Cancel this booking? This will remove it.",
              )
            ) {
              return;
            }

            const res =
              await fetch(
                `/api/bookings/${booking.id}`,
                {
                  method: "DELETE",
                },
              );

            if (res.ok) {
              router.push(
                "/bookings",
              );

              router.refresh();
            }
          }}
          className="btn btn-ghost w-full text-red-600"
        >
          Cancel booking
        </button>

      </div>

      {/* CHECKOUT MODAL */}
      {checkoutOpen && (
        <CheckoutModal
          bookingId={
            booking.id
          }
          total={total}
          discount={
            discountAmt
          }
          currency={
            currency
          }
          onClose={() =>
            setCheckoutOpen(
              false,
            )
          }
          onSuccess={() => {
            router.push(
              `/invoice/${booking.id}`,
            );

            router.refresh();
          }}
        />
      )}

    </div>
  );
}

// ============================================================================
// CHECKOUT MODAL
// ============================================================================

function CheckoutModal({
  bookingId,
  total,
  discount,
  currency,
  onClose,
  onSuccess,
}: {
  bookingId: number;
  total: number;
  discount: number;
  currency: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [
    method,
    setMethod,
  ] =
    useState<
      "cash" | "visa" | "instapay"
    >("cash");

  const [paid, setPaid] =
    useState(
      total.toFixed(2),
    );

  const [
    loading,
    setLoading,
  ] = useState(false);

  const [
    error,
    setError,
  ] = useState<
    string | null
  >(null);

  const paidNum =
    parseFloat(
      paid || "0",
    ) || 0;

  const change =
    method === "cash"
      ? Math.max(
          0,
          paidNum - total,
        )
      : 0;

  async function confirm() {
    if (loading) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res =
        await fetch(
          `/api/bookings/${bookingId}/checkout`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              paymentMethod:
                method,
              paidAmount:
                paidNum,
              discount,
            }),
          },
        );

      let data:
        | {
            error?: string;
            total?: number;
            change?: number;
          }
        | null = null;

      try {
        data =
          await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        setError(
          data?.error ||
            "Checkout failed. Please try again.",
        );

        setLoading(false);
        return;
      }

      // Server is the source of truth.
      // Close modal and go to the invoice only after
      // the booking has actually been closed.
      onSuccess();
    } catch {
      setError(
        "Network error. Please try again.",
      );

      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">

      <div className="card w-full max-w-md p-6">

        <div className="flex items-start justify-between mb-4">

          <div>

            <div className="text-xs uppercase text-indigo-600 font-semibold">
              Checkout
            </div>

            <h3 className="text-xl font-bold">
              {total.toFixed(
                2,
              )}{" "}
              {currency}
            </h3>

          </div>

          <button
            onClick={onClose}
            disabled={loading}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 grid place-items-center disabled:opacity-50"
          >
            ✕
          </button>

        </div>

        {/* PAYMENT METHOD */}
        <div className="grid grid-cols-3 gap-2 mb-4">

          {(
            [
              "cash",
              "visa",
              "instapay",
            ] as const
          ).map((m) => (

            <button
              key={m}
              onClick={() =>
                setMethod(m)
              }
              disabled={loading}
              className={`p-3 rounded-xl border font-semibold text-sm capitalize ${
                method === m
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 hover:border-slate-300"
              } disabled:opacity-50`}
            >

              <div className="text-xl">
                {m ===
                "cash"
                  ? "💵"
                  : m ===
                    "visa"
                  ? "💳"
                  : "📱"}
              </div>

              {m ===
              "instapay"
                ? "InstaPay"
                : m}

            </button>

          ))}

        </div>

        {/* PAID */}
        <div className="space-y-3">

          <div>

            <label className="label">
              Paid amount
            </label>

            <input
              type="number"
              className="input text-2xl font-bold text-center"
              value={paid}
              step="0.01"
              min="0"
              disabled={loading}
              onChange={(e) =>
                setPaid(
                  e.target.value,
                )
              }
            />

          </div>

          {/* CHANGE */}
          {method ===
            "cash" && (
            <div
              className={`p-3 rounded-xl text-sm font-semibold ${
                change > 0
                  ? "bg-emerald-50 text-emerald-800"
                  : paidNum >=
                    total
                  ? "bg-slate-50 text-slate-600"
                  : "bg-red-50 text-red-800"
              }`}
            >
              {paidNum <
              total
                ? `Short by ${(
                    total -
                    paidNum
                  ).toFixed(
                    2,
                  )} ${currency}`
                : `Change: ${change.toFixed(
                    2,
                  )} ${currency}`}
            </div>
          )}

          {/* ERROR */}
          {error && (
            <div className="p-3 rounded-xl bg-red-50 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* CONFIRM */}
          <button
            onClick={
              confirm
            }
            disabled={
              loading ||
              (method ===
                "cash" &&
                paidNum <
                  total)
            }
            className="btn btn-success w-full py-3"
          >
            {loading
              ? "Processing…"
              : "Confirm & print invoice 🧾"}
          </button>

        </div>

      </div>

    </div>
  );
}

// ============================================================================
// SMALL ROW
// ============================================================================

function Row({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">

      <span className="text-slate-600">
        {label}
      </span>

      <span className="font-semibold tabular-nums">
        {value}
      </span>

    </div>
  );
}

// ============================================================================
// FORMAT TIMER
// ============================================================================

function formatDur(
  ms: number,
): string {
  const s =
    Math.floor(
      ms / 1000,
    );

  const h =
    Math.floor(
      s / 3600,
    );

  const m =
    Math.floor(
      (s % 3600) /
        60,
    );

  const sec =
    s % 60;

  return `${String(h).padStart(
    2,
    "0",
  )}:${String(m).padStart(
    2,
    "0",
  )}:${String(sec).padStart(
    2,
    "0",
  )}`;
}