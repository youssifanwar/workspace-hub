"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { useRouter } from "next/navigation";

/* -------------------------------------------------------------------------- */
/* TYPES                                                                       */
/* -------------------------------------------------------------------------- */

type Booking = {
  id: number;

  customerName: string;

  customerPhone: string;

  deskName: string;

  deskType:
    | "desk"
    | "meeting_room";

  checkedInAt: string;

  hourlyRate: string;

  ordersTotal: string;

  discount: string;

  billingMode:
    | "regular"
    | "package";

  subscriptionId:
    | number
    | null;

  subscriptionHoursUsed:
    | string
    | null;
};

type Subscription = {
  id: number;

  packageName: string;

  totalHours: number;

  price: number;

  validityDays:
    | number
    | null;

  startsAt: string;

  expiresAt:
    | string
    | null;

  remainingHours: number;
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

  imageUrl:
    | string
    | null;

  icon: string;
};

/* -------------------------------------------------------------------------- */
/* SESSION PRICING                                                             */
/* -------------------------------------------------------------------------- */

const FIRST_HOUR_PRICE = 40;

const EXTRA_HOUR_PRICE = 30;

const DAY_PASS_PRICE = 150;

function calculateSessionPrice(
  billableHours: number,
) {
  if (billableHours <= 1) {
    return {
      seatCharge:
        FIRST_HOUR_PRICE,

      pricingType:
        "hour" as const,
    };
  }

  if (billableHours === 2) {
    return {
      seatCharge:
        FIRST_HOUR_PRICE +
        EXTRA_HOUR_PRICE,

      pricingType:
        "hour" as const,
    };
  }

  if (billableHours === 3) {
    return {
      seatCharge:
        FIRST_HOUR_PRICE +
        EXTRA_HOUR_PRICE * 2,

      pricingType:
        "hour" as const,
    };
  }

  if (billableHours === 4) {
    return {
      seatCharge:
        FIRST_HOUR_PRICE +
        EXTRA_HOUR_PRICE * 3,

      pricingType:
        "hour" as const,
    };
  }

  return {
    seatCharge:
      DAY_PASS_PRICE,

    pricingType:
      "day" as const,
  };
}

/* -------------------------------------------------------------------------- */
/* MAIN                                                                        */
/* -------------------------------------------------------------------------- */

export default function BookingView({
  booking,

  subscription,

  items: initialItems,

  categories,

  products,

  currency,
}: {
  booking: Booking;

  subscription:
    | Subscription
    | null;

  items: Item[];

  categories: Category[];

  products: Product[];

  currency: string;
}) {
  const router =
    useRouter();

  const [items, setItems] =
    useState<Item[]>(
      initialItems,
    );

  const [activeCat, setActiveCat] =
    useState<number | null>(
      categories[0]?.id ??
        null,
    );

  const [now, setNow] =
    useState<Date>(
      new Date(),
    );

  const [busy, setBusy] =
    useState(false);

  const [checkoutOpen, setCheckoutOpen] =
    useState(false);

  const [discount, setDiscount] =
    useState(
      booking.discount,
    );

  /* ------------------------------------------------------------------------ */
  /* TIMER                                                                    */
  /* ------------------------------------------------------------------------ */

  useEffect(() => {
    const timer =
      setInterval(() => {
        setNow(
          new Date(),
        );
      }, 1000);

    return () =>
      clearInterval(
        timer,
      );
  }, []);

  const startedAt =
    new Date(
      booking.checkedInAt,
    );

  const durationMs =
    Math.max(
      0,
      now.getTime() -
        startedAt.getTime(),
    );

  const durationH =
    durationMs /
    3_600_000;

  const billableHours =
    Math.max(
      1,
      Math.ceil(
        durationH,
      ),
    );

  /* ------------------------------------------------------------------------ */
  /* BILLING MODE                                                             */
  /* ------------------------------------------------------------------------ */

  const isPackage =
    booking.billingMode ===
    "package";

  /* ------------------------------------------------------------------------ */
  /* PRICE                                                                     */
  /* ------------------------------------------------------------------------ */

  const regularPricing =
    calculateSessionPrice(
      billableHours,
    );

  const seatCharge =
    isPackage
      ? 0
      : regularPricing.seatCharge;

  /* ------------------------------------------------------------------------ */
  /* GROUP ITEMS                                                              */
  /* ------------------------------------------------------------------------ */

  const groupedItems =
    useMemo<GroupedItem[]>(
      () => {
        const groups =
          new Map<
            string,
            GroupedItem
          >();

        for (const item of items) {
          const normalizedName =
            item.name
              .trim()
              .toLowerCase();

          const normalizedPrice =
            parseFloat(
              item.unitPrice,
            ).toFixed(2);

          const key =
            `${normalizedName}__${normalizedPrice}`;

          const existing =
            groups.get(
              key,
            );

          if (existing) {
            existing.quantity +=
              item.quantity;

            existing.itemIds.push(
              item.id,
            );
          } else {
            groups.set(
              key,
              {
                ...item,

                itemIds: [
                  item.id,
                ],
              },
            );
          }
        }

        return Array.from(
          groups.values(),
        );
      },
      [items],
    );

  /* ------------------------------------------------------------------------ */
  /* F&B TOTAL                                                                */
  /* ------------------------------------------------------------------------ */

  const ordersTotal =
    groupedItems.reduce(
      (
        sum,
        item,
      ) =>
        sum +
        item.quantity *
          parseFloat(
            item.unitPrice,
          ),

      0,
    );

  /* ------------------------------------------------------------------------ */
  /* DISCOUNT                                                                 */
  /* ------------------------------------------------------------------------ */

  const discountAmt =
    parseFloat(
      discount || "0",
    ) || 0;

  /* ------------------------------------------------------------------------ */
  /* TOTAL                                                                     */
  /* ------------------------------------------------------------------------ */

  const total =
    Math.max(
      0,
      seatCharge +
        ordersTotal -
        discountAmt,
    );

  /* ------------------------------------------------------------------------ */
  /* PACKAGE REMAINING                                                        */
  /* ------------------------------------------------------------------------ */

  const packageRemaining =
    subscription?.remainingHours ??
    null;

  const packageEnough =
    !isPackage ||
    packageRemaining ===
      null ||
    packageRemaining >=
      billableHours;

  /* ------------------------------------------------------------------------ */
  /* PRODUCTS                                                                 */
  /* ------------------------------------------------------------------------ */

  const filteredProducts =
    useMemo(
      () =>
        products.filter(
          (product) =>
            activeCat
              ? product.categoryId ===
                activeCat
              : true,
        ),

      [
        products,
        activeCat,
      ],
    );

  /* ------------------------------------------------------------------------ */
  /* ADD PRODUCT                                                              */
  /* ------------------------------------------------------------------------ */

  async function addProduct(
    product: Product,
  ) {
    setBusy(true);

    try {
      const response =
        await fetch(
          `/api/bookings/${booking.id}/items`,
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              productId:
                product.id,

              quantity: 1,
            }),
          },
        );

      if (!response.ok) {
        return;
      }

      const data =
        (await response.json()) as {
          item: Item;
        };

      setItems((previous) => {
        const existing =
          previous.find(
            (item) =>
              item.name ===
                data.item
                  .name &&
              parseFloat(
                item.unitPrice,
              ) ===
                parseFloat(
                  data.item
                    .unitPrice,
                ),
          );

        if (existing) {
          return previous.map(
            (item) =>
              item.id ===
              existing.id
                ? {
                    ...item,

                    quantity:
                      item.quantity +
                      data.item
                        .quantity,
                  }
                : item,
          );
        }

        return [
          ...previous,
          data.item,
        ];
      });
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* UPDATE ITEM                                                              */
  /* ------------------------------------------------------------------------ */

  async function updateItem(
    id: number,
    quantity: number,
  ) {
    setBusy(true);

    try {
      if (
        quantity <= 0
      ) {
        const response =
          await fetch(
            `/api/bookings/${booking.id}/items?itemId=${id}`,
            {
              method:
                "DELETE",
            },
          );

        if (response.ok) {
          setItems(
            (previous) =>
              previous.filter(
                (item) =>
                  item.id !==
                  id,
              ),
          );
        }

        return;
      }

      const response =
        await fetch(
          `/api/bookings/${booking.id}/items`,
          {
            method:
              "PATCH",

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

      if (response.ok) {
        setItems(
          (previous) =>
            previous.map(
              (item) =>
                item.id ===
                id
                  ? {
                      ...item,

                      quantity,
                    }
                  : item,
            ),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function updateGroupedItem(
    item: GroupedItem,
    quantity: number,
  ) {
    await updateItem(
      item.id,
      quantity,
    );
  }

  /* ------------------------------------------------------------------------ */
  /* RENDER                                                                   */
  /* ------------------------------------------------------------------------ */

  return (
    <div className="grid lg:grid-cols-[1fr_400px] gap-6">
      {/* LEFT */}

      <div className="space-y-4">

        {/* SESSION INFO */}

        <div className="card p-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <div className="text-xs uppercase text-slate-500 font-semibold">
                Active Session
              </div>

              <div className="flex items-center gap-3 mt-1">
                <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-700 grid place-items-center font-bold">
                  {booking.customerName
                    .charAt(0)
                    .toUpperCase()}
                </div>

                <div>
                  <div className="font-bold">
                    {
                      booking.customerName
                    }
                  </div>

                  <div className="text-xs text-slate-500">
                    📞{" "}
                    {
                      booking.customerPhone
                    }

                    {" · "}

                    Session #
                    {
                      booking.id
                    }
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

              {isPackage ? (
                <div className="mt-2 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold">
                  📦 Package
                </div>
              ) : (
                <div className="text-xs font-semibold text-indigo-600 mt-1">
                  {regularPricing.pricingType ===
                  "day"
                    ? "Day Pass · 150"
                    : `${billableHours} ${
                        billableHours ===
                        1
                          ? "hour"
                          : "hours"
                      } · ${seatCharge} ${currency}`}
                </div>
              )}
            </div>
          </div>

          {/* PACKAGE INFO */}

          {isPackage &&
            subscription && (
              <div className="mt-4 rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase text-indigo-600 font-bold">
                      Active Package
                    </div>

                    <div className="text-lg font-bold text-indigo-900 mt-1">
                      📦{" "}
                      {
                        subscription.packageName
                      }
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs text-indigo-600">
                      Remaining
                    </div>

                    <div className="text-xl font-bold text-indigo-900">
                      {packageRemaining !==
                      null
                        ? packageRemaining.toFixed(
                            2,
                          )
                        : "—"}
                      h
                    </div>
                  </div>
                </div>

                <div className="grid sm:grid-cols-3 gap-3 mt-4">
                  <PackageInfo
                    label="Total hours"
                    value={`${subscription.totalHours.toFixed(
                      0,
                    )}h`}
                  />

                  <PackageInfo
                    label="This session"
                    value={`${billableHours}h`}
                  />

                  <PackageInfo
                    label="Expires"
                    value={
                      subscription.expiresAt
                        ? new Date(
                            subscription.expiresAt,
                          ).toLocaleDateString(
                            "en-GB",
                          )
                        : "No expiry"
                    }
                  />
                </div>

                {!packageEnough && (
                  <div className="mt-3 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm font-semibold">
                    ⚠️ Not enough package
                    hours for this session.
                    Remaining{" "}
                    {
                      packageRemaining?.toFixed(
                        2,
                      )
                    }
                    h · required{" "}
                    {billableHours}h
                  </div>
                )}
              </div>
            )}
        </div>

        {/* CATEGORIES */}

        <div className="flex gap-2 overflow-x-auto scroll-fade pb-1">
          {categories.map(
            (category) => (
              <button
                key={
                  category.id
                }
                onClick={() =>
                  setActiveCat(
                    category.id,
                  )
                }
                className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition ${
                  activeCat ===
                  category.id
                    ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/30"
                    : "bg-white border border-slate-200 text-slate-700 hover:border-indigo-300"
                }`}
              >
                <span className="mr-1">
                  {
                    category.icon
                  }
                </span>

                {
                  category.name
                }
              </button>
            ),
          )}
        </div>

        {/* PRODUCTS */}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {filteredProducts.length ===
            0 && (
            <div className="col-span-full text-center py-10 text-slate-400 text-sm">
              No products in this
              category
            </div>
          )}

          {filteredProducts.map(
            (product) => (
              <button
                key={
                  product.id
                }
                onClick={() =>
                  addProduct(
                    product,
                  )
                }
                disabled={busy}
                className="group aspect-square rounded-2xl bg-white border border-slate-200 hover:border-indigo-400 hover:-translate-y-0.5 transition overflow-hidden text-left flex flex-col"
              >
                <div className="flex-1 bg-slate-100 relative overflow-hidden">
                  {product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={
                        product.imageUrl
                      }
                      alt={
                        product.name
                      }
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full grid place-items-center text-5xl">
                      {
                        product.icon
                      }
                    </div>
                  )}

                  <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/95 text-lg grid place-items-center shadow">
                    {
                      product.icon
                    }
                  </div>
                </div>

                <div className="p-2.5">
                  <div className="font-semibold text-sm text-slate-800 truncate">
                    {
                      product.name
                    }
                  </div>

                  <div className="text-xs text-indigo-600 font-bold">
                    {parseFloat(
                      product.price,
                    ).toFixed(
                      2,
                    )}{" "}
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

        {/* BILL */}

        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold">
              Session Bill
            </h3>

            {isPackage && (
              <span className="px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700 text-xs font-bold">
                📦 Package
              </span>
            )}
          </div>

          {/* ITEMS */}

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
                        {
                          item.name
                        }
                      </div>

                      <div className="text-xs text-slate-500">
                        {parseFloat(
                          item.unitPrice,
                        ).toFixed(
                          2,
                        )}
                        {" × "}
                        {
                          item.quantity
                        }
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
                        disabled={
                          busy
                        }
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold disabled:opacity-50"
                      >
                        −
                      </button>

                      <span className="w-6 text-center font-bold tabular-nums">
                        {
                          item.quantity
                        }
                      </span>

                      <button
                        onClick={() =>
                          updateGroupedItem(
                            item,
                            item.quantity +
                              1,
                          )
                        }
                        disabled={
                          busy
                        }
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
                      ).toFixed(
                        2,
                      )}
                    </div>
                  </div>
                ),
              )
            )}
          </div>

          {/* TOTALS */}

          <div className="border-t border-slate-100 mt-3 pt-3 space-y-2 text-sm">

            {isPackage ? (
              <>
                <Row
                  label="Package"
                  value="Included"
                />

                <Row
                  label="Package usage"
                  value={`${billableHours} ${
                    billableHours ===
                    1
                      ? "hour"
                      : "hours"
                  }`}
                />
              </>
            ) : (
              <>
                <Row
                  label="Seat charge"
                  value={`${seatCharge.toFixed(
                    2,
                  )} ${currency}`}
                />

                <Row
                  label={
                    regularPricing.pricingType ===
                    "day"
                      ? "Day Pass"
                      : "Billable hours"
                  }
                  value={
                    regularPricing.pricingType ===
                    "day"
                      ? "150.00"
                      : `${billableHours}`
                  }
                />
              </>
            )}

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
                value={
                  discount
                }
                min="0"
                step="0.01"
                disabled={
                  busy
                }
                onChange={(
                  event,
                ) =>
                  setDiscount(
                    event.target
                      .value,
                  )
                }
              />
            </div>

            <div className="border-t border-slate-100 pt-2 flex items-center justify-between text-lg font-bold">
              <span>
                Total
              </span>

              <span className="tabular-nums text-indigo-700">
                {total.toFixed(
                  2,
                )}{" "}
                {currency}
              </span>
            </div>
          </div>

          {/* PACKAGE NOTE */}

          {isPackage && (
            <div className="mt-3 p-3 rounded-xl bg-indigo-50 text-indigo-800 text-xs font-semibold">
              💡 Seat time is included
              in the package. Only F&B
              and applicable discounts
              affect the amount due.
            </div>
          )}

          {/* CHECKOUT */}

          <button
            onClick={() =>
              setCheckoutOpen(
                true,
              )
            }
            disabled={
              busy ||
              !packageEnough
            }
            className="btn btn-primary w-full mt-4 py-3"
          >
            💳 Checkout
          </button>
        </div>

        {/* CANCEL */}

        <button
          onClick={async () => {
            if (
              !confirm(
                "Cancel this session? This will remove it.",
              )
            ) {
              return;
            }

            const response =
              await fetch(
                `/api/bookings/${booking.id}`,
                {
                  method:
                    "DELETE",
                },
              );

            if (
              response.ok
            ) {
              router.push(
                "/bookings",
              );

              router.refresh();
            }
          }}
          className="btn btn-ghost w-full text-red-600"
        >
          Cancel session
        </button>
      </div>

      {/* CHECKOUT MODAL */}

      {checkoutOpen && (
        <CheckoutModal
          bookingId={
            booking.id
          }

          total={
            total
          }

          discount={
            discountAmt
          }

          currency={
            currency
          }

          isPackage={
            isPackage
          }

          packageRemaining={
            packageRemaining
          }

          packageHoursUsed={
            billableHours
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

/* -------------------------------------------------------------------------- */
/* PACKAGE INFO                                                               */
/* -------------------------------------------------------------------------- */

function PackageInfo({
  label,
  value,
}: {
  label: string;

  value: string;
}) {
  return (
    <div className="bg-white/70 rounded-xl p-3">
      <div className="text-[11px] uppercase text-slate-500 font-semibold">
        {label}
      </div>

      <div className="font-bold text-slate-800 mt-1">
        {value}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* CHECKOUT MODAL                                                             */
/* -------------------------------------------------------------------------- */

function CheckoutModal({
  bookingId,

  total,

  discount,

  currency,

  isPackage,

  packageRemaining,

  packageHoursUsed,

  onClose,

  onSuccess,
}: {
  bookingId: number;

  total: number;

  discount: number;

  currency: string;

  isPackage: boolean;

  packageRemaining:
    | number
    | null;

  packageHoursUsed: number;

  onClose: () => void;

  onSuccess: () => void;
}) {
  const [
    method,
    setMethod,
  ] = useState<
    "cash" | "visa" | "instapay"
  >("cash");

  const [paid, setPaid] =
    useState(
      total.toFixed(
        2,
      ),
    );

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<
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
          paidNum -
            total,
        )
      : 0;

  async function confirm() {
    if (loading) {
      return;
    }

    if (
      isPackage &&
      packageRemaining !==
        null &&
      packageRemaining <
        packageHoursUsed
    ) {
      setError(
        `Not enough package hours. Remaining ${packageRemaining.toFixed(
          2,
        )}h, required ${packageHoursUsed}h.`,
      );

      return;
    }

    setLoading(true);

    setError(null);

    try {
      const response =
        await fetch(
          `/api/bookings/${bookingId}/checkout`,
          {
            method:
              "POST",

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

      const data =
        (await response
          .json()
          .catch(
            () => null,
          )) as {
          error?: string;
        } | null;

      if (
        !response.ok
      ) {
        setError(
          data?.error ??
            "Checkout failed. Please try again.",
        );

        setLoading(false);

        return;
      }

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

            {isPackage && (
              <div className="text-xs text-indigo-600 font-semibold mt-1">
                📦 Package session
              </div>
            )}

            <h3 className="text-xl font-bold mt-1">
              {total.toFixed(
                2,
              )}{" "}
              {currency}
            </h3>
          </div>

          <button
            onClick={
              onClose
            }
            disabled={
              loading
            }
            className="w-8 h-8 rounded-lg hover:bg-slate-100 grid place-items-center disabled:opacity-50"
          >
            ✕
          </button>
        </div>

        {isPackage && (
          <div className="mb-4 p-3 rounded-xl bg-indigo-50 border border-indigo-100 text-sm">
            <div className="font-bold text-indigo-900">
              Package usage
            </div>

            <div className="mt-1 text-indigo-700">
              This session:
              {" "}
              {
                packageHoursUsed
              }
              h
            </div>

            <div className="text-indigo-700">
              Remaining:
              {" "}
              {packageRemaining !==
              null
                ? packageRemaining.toFixed(
                    2,
                  )
                : "—"}
              h
            </div>
          </div>
        )}

        {/* PAYMENT METHOD */}

        <div className="grid grid-cols-3 gap-2 mb-4">
          {(
            [
              "cash",
              "visa",
              "instapay",
            ] as const
          ).map(
            (paymentMethod) => (
              <button
                key={
                  paymentMethod
                }
                onClick={() =>
                  setMethod(
                    paymentMethod,
                  )
                }
                disabled={
                  loading
                }
                className={`p-3 rounded-xl border font-semibold text-sm capitalize ${
                  method ===
                  paymentMethod
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 hover:border-slate-300"
                } disabled:opacity-50`}
              >
                <div className="text-xl">
                  {paymentMethod ===
                  "cash"
                    ? "💵"
                    : paymentMethod ===
                        "visa"
                    ? "💳"
                    : "📱"}
                </div>

                {paymentMethod ===
                "instapay"
                  ? "InstaPay"
                  : paymentMethod}
              </button>
            ),
          )}
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
              disabled={
                loading
              }
              onChange={(event) =>
                setPaid(
                  event.target
                    .value,
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
              : isPackage
              ? "Confirm package checkout 🧾"
              : "Confirm & print invoice 🧾"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* ROW                                                                         */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* TIMER FORMAT                                                               */
/* -------------------------------------------------------------------------- */

function formatDur(
  milliseconds: number,
): string {
  const seconds =
    Math.floor(
      milliseconds /
        1000,
    );

  const hours =
    Math.floor(
      seconds /
        3600,
    );

  const minutes =
    Math.floor(
      (seconds %
        3600) /
        60,
    );

  const remainingSeconds =
    seconds % 60;

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
    remainingSeconds,
  ).padStart(
    2,
    "0",
  )}`;
}