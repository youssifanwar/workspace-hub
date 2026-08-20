"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Desk = {
  id: number;
  name: string;
  type: string;
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
  icon: string;
  imageUrl: string | null;
};

type Booking = {
  id: number;
  customerName: string;
  checkedInAt: string;
};

type CartItem = {
  product: Product;
  quantity: number;
  note: string;
};

function createRequestId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

export default function PublicMenu({
  deskId,
}: {
  deskId: number;
}) {
  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [desk, setDesk] =
    useState<Desk | null>(null);

  const [booking, setBooking] =
    useState<Booking | null>(null);

  const [categories, setCategories] =
    useState<Category[]>([]);

  const [products, setProducts] =
    useState<Product[]>([]);

  const [activeCat, setActiveCat] =
    useState<number | null>(null);

  const [cart, setCart] =
    useState<Record<number, CartItem>>({});

  const [cartOpen, setCartOpen] =
    useState(false);

  const [customerNote, setCustomerNote] =
    useState("");

  const [placing, setPlacing] =
    useState(false);

  const [placed, setPlaced] =
    useState<{
      ticketNumber: number;
      total: number;
    } | null>(null);

  // ---------------------------------------------------------------------------
  // IMPORTANT:
  // Keep the same requestId when retrying the exact same order.
  //
  // Example:
  //
  // Phone sends order
  //        ↓
  // Server creates Ticket #12
  //        ↓
  // Network response is lost
  //        ↓
  // User presses Place Order again
  //        ↓
  // Same requestId
  //        ↓
  // Server returns Ticket #12 instead of creating #13
  // ---------------------------------------------------------------------------

  const pendingRequestId =
    useRef<string | null>(null);

  // ---------------------------------------------------------------------------
  // LOAD MENU
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch(
          `/api/public/desks/${deskId}/menu`,
          {
            cache: "no-store",
          },
        );

        const data =
          await res.json();

        if (ignore) {
          return;
        }

        if (!res.ok) {
          setError(
            data.error ||
              "Failed to load menu",
          );

          setLoading(false);
          return;
        }

        setDesk(data.desk);
        setBooking(data.booking);
        setCategories(
          data.categories || [],
        );
        setProducts(
          data.products || [],
        );

        setActiveCat(
          data.categories?.[0]?.id ??
            null,
        );

        setLoading(false);
      } catch {
        if (!ignore) {
          setError(
            "Network error",
          );

          setLoading(false);
        }
      }
    }

    load();

    return () => {
      ignore = true;
    };
  }, [deskId]);

  // ---------------------------------------------------------------------------
  // FILTER PRODUCTS
  // ---------------------------------------------------------------------------

  const filtered = useMemo(
    () =>
      activeCat
        ? products.filter(
            (p) =>
              p.categoryId ===
              activeCat,
          )
        : products,
    [
      products,
      activeCat,
    ],
  );

  // ---------------------------------------------------------------------------
  // CART
  // ---------------------------------------------------------------------------

  const cartArr =
    Object.values(cart);

  const cartCount =
    cartArr.reduce(
      (sum, item) =>
        sum + item.quantity,
      0,
    );

  const cartTotal =
    cartArr.reduce(
      (sum, item) =>
        sum +
        item.quantity *
          parseFloat(
            item.product.price,
          ),
      0,
    );

  // ---------------------------------------------------------------------------
  // CART CHANGES
  //
  // If the user changes the order after a failed attempt, that is a NEW order.
  // Therefore generate a fresh requestId on the next Place Order.
  // ---------------------------------------------------------------------------

  function invalidatePendingRequest() {
    if (!placing) {
      pendingRequestId.current =
        null;
    }
  }

  function addToCart(
    product: Product,
  ) {
    invalidatePendingRequest();

    setCart((prev) => ({
      ...prev,

      [product.id]: prev[
        product.id
      ]
        ? {
            ...prev[
              product.id
            ],
            quantity:
              prev[
                product.id
              ].quantity + 1,
          }
        : {
            product,
            quantity: 1,
            note: "",
          },
    }));
  }

  function changeQty(
    id: number,
    delta: number,
  ) {
    invalidatePendingRequest();

    setCart((prev) => {
      const current =
        prev[id];

      if (!current) {
        return prev;
      }

      const quantity =
        current.quantity + delta;

      if (quantity <= 0) {
        const next = {
          ...prev,
        };

        delete next[id];

        return next;
      }

      return {
        ...prev,
        [id]: {
          ...current,
          quantity,
        },
      };
    });
  }

  function setNote(
    id: number,
    note: string,
  ) {
    invalidatePendingRequest();

    setCart((prev) => {
      const current =
        prev[id];

      if (!current) {
        return prev;
      }

      return {
        ...prev,
        [id]: {
          ...current,
          note,
        },
      };
    });
  }

  function setWholeOrderNote(
    note: string,
  ) {
    invalidatePendingRequest();
    setCustomerNote(note);
  }

  // ---------------------------------------------------------------------------
  // PLACE ORDER
  // ---------------------------------------------------------------------------

  async function placeOrder() {
    // Extra protection against double click.
    if (placing) {
      return;
    }

    if (!booking) {
      setError(
        "Please ask the staff to check you in first.",
      );
      return;
    }

    if (cartArr.length === 0) {
      return;
    }

    setPlacing(true);
    setError(null);

    // Create ONE request ID for this exact attempt.
    //
    // We intentionally do NOT regenerate it if a retry happens after a
    // network failure and the cart was not changed.
    if (
      !pendingRequestId.current
    ) {
      pendingRequestId.current =
        createRequestId();
    }

    const requestId =
      pendingRequestId.current;

    try {
      const res = await fetch(
        `/api/public/desks/${deskId}/order`,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            requestId,

            customerNote:
              customerNote
                .trim(),

            items: cartArr.map(
              (item) => ({
                productId:
                  item.product.id,

                quantity:
                  item.quantity,

                note:
                  item.note
                    .trim(),
              }),
            ),
          }),
        },
      );

      const data =
        await res.json().catch(
          () => ({}),
        );

      if (!res.ok) {
        setError(
          data.error ||
            "Could not place order",
        );

        setPlacing(false);

        // IMPORTANT:
        // Keep requestId here so a network retry can safely return
        // the same ticket if the server actually created it.
        return;
      }

      // -----------------------------------------------------------------------
      // SUCCESS
      // -----------------------------------------------------------------------

      setPlaced({
        ticketNumber:
          Number(
            data.ticketNumber,
          ),

        total:
          Number(
            data.total || 0,
          ),
      });

      // Clear cart only after confirmed success.
      setCart({});

      setCustomerNote("");

      setCartOpen(false);

      // The request is finished successfully.
      pendingRequestId.current =
        null;
    } catch {
      // -----------------------------------------------------------------------
      // NETWORK ERROR
      //
      // Do NOT clear requestId here.
      //
      // If the server already created the order but the response was lost,
      // the next click will use the same requestId and the API will return
      // the existing ticket instead of creating a duplicate.
      // -----------------------------------------------------------------------

      setError(
        "Network error. Please try again.",
      );
    } finally {
      setPlacing(false);
    }
  }

  // ---------------------------------------------------------------------------
  // LOADING
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center text-slate-500">
        Loading menu…
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // INITIAL ERROR
  // ---------------------------------------------------------------------------

  if (
    error &&
    !desk
  ) {
    return (
      <div className="min-h-screen grid place-items-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-3">
            😕
          </div>

          <div className="font-bold text-lg">
            {error}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // ORDER SUCCESS
  // ---------------------------------------------------------------------------

  if (placed) {
    return (
      <div className="min-h-screen grid place-items-center p-6 bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
        <div className="text-center max-w-sm">
          <div className="text-7xl mb-4">
            ✅
          </div>

          <div className="text-3xl font-bold mb-2">
            Order placed!
          </div>

          <div className="text-white/90 mb-6">
            Ticket #
            {String(
              placed.ticketNumber,
            ).padStart(
              3,
              "0",
            )}{" "}
            · your order is on its way.
          </div>

          <div className="text-4xl font-bold tabular-nums mb-8">
            {placed.total.toFixed(
              2,
            )}
          </div>

          <button
            onClick={() =>
              setPlaced(null)
            }
            className="px-6 py-3 rounded-2xl bg-white text-emerald-700 font-bold shadow-lg"
          >
            Order more →
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // MAIN PAGE
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-50 pb-32">

      {/* --------------------------------------------------------------------- */}
      {/* HEADER                                                                */}
      {/* --------------------------------------------------------------------- */}

      <div className="bg-gradient-to-br from-indigo-600 to-cyan-500 text-white p-5 rounded-b-3xl shadow-lg">

        <div className="text-xs uppercase tracking-wider text-white/80">
          {desk?.type ===
          "meeting_room"
            ? "Meeting Room"
            : "Desk"}
        </div>

        <div className="text-2xl font-bold">
          {desk?.name}
        </div>

        {booking ? (
          <div className="mt-2 text-sm bg-white/15 rounded-xl px-3 py-2 inline-block">
            👤{" "}
            {booking.customerName}{" "}
            · session active
          </div>
        ) : (
          <div className="mt-2 text-sm bg-red-500/25 border border-red-300/40 rounded-xl px-3 py-2">
            ⚠️ No active session.
            Please ask the staff to
            check you in first.
          </div>
        )}

      </div>

      {/* --------------------------------------------------------------------- */}
      {/* CATEGORY TABS                                                         */}
      {/* --------------------------------------------------------------------- */}

      <div className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur border-b border-slate-200">

        <div className="flex gap-2 overflow-x-auto px-4 py-3 scroll-fade">

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
                className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition ${
                  activeCat ===
                  category.id
                    ? "bg-indigo-600 text-white shadow"
                    : "bg-white border border-slate-200 text-slate-700"
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
      </div>

      {/* --------------------------------------------------------------------- */}
      {/* PRODUCTS                                                              */}
      {/* --------------------------------------------------------------------- */}

      <div className="p-4 grid grid-cols-2 gap-3">

        {filtered.map(
          (product) => {
            const inCart =
              cart[
                product.id
              ]?.quantity || 0;

            return (
              <button
                key={
                  product.id
                }
                onClick={() =>
                  addToCart(
                    product,
                  )
                }
                disabled={
                  placing
                }
                className="text-left bg-white rounded-2xl overflow-hidden border border-slate-200 active:scale-[.98] transition disabled:opacity-60"
              >
                <div className="aspect-square bg-slate-100 relative overflow-hidden">

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
                    <div className="w-full h-full grid place-items-center text-6xl">
                      {
                        product.icon
                      }
                    </div>
                  )}

                  {inCart >
                    0 && (
                    <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-indigo-600 text-white text-sm font-bold grid place-items-center shadow">
                      {
                        inCart
                      }
                    </div>
                  )}

                </div>

                <div className="p-3">

                  <div className="font-semibold text-sm text-slate-800 line-clamp-1">
                    {
                      product.name
                    }
                  </div>

                  <div className="flex items-center justify-between mt-1">

                    <div className="text-indigo-600 font-bold text-sm">
                      {parseFloat(
                        product.price,
                      ).toFixed(
                        2,
                      )}
                    </div>

                    <div className="w-7 h-7 rounded-full bg-indigo-600 text-white grid place-items-center text-sm font-bold">
                      +
                    </div>

                  </div>

                </div>
              </button>
            );
          },
        )}

      </div>

      {/* --------------------------------------------------------------------- */}
      {/* CART BAR                                                              */}
      {/* --------------------------------------------------------------------- */}

      {cartCount > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-30">

          <button
            onClick={() =>
              setCartOpen(
                true,
              )
            }
            disabled={
              !booking ||
              placing
            }
            className="w-full py-4 px-5 rounded-2xl bg-indigo-600 text-white font-bold shadow-2xl flex items-center justify-between disabled:opacity-60"
          >

            <span className="flex items-center gap-3">

              <span className="w-8 h-8 rounded-full bg-white/25 grid place-items-center text-sm">
                {
                  cartCount
                }
              </span>

              View cart

            </span>

            <span className="tabular-nums">
              {cartTotal.toFixed(
                2,
              )}
            </span>

          </button>

        </div>
      )}

      {/* --------------------------------------------------------------------- */}
      {/* CART DRAWER                                                           */}
      {/* --------------------------------------------------------------------- */}

      {cartOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() =>
            !placing &&
            setCartOpen(
              false,
            )
          }
        >

          <div
            className="absolute bottom-0 inset-x-0 bg-white rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto scroll-fade"
            onClick={(e) =>
              e.stopPropagation()
            }
          >

            {/* HEADER */}
            <div className="flex items-center justify-between mb-4">

              <div className="text-xl font-bold">
                Your order
              </div>

              <button
                onClick={() =>
                  setCartOpen(
                    false,
                  )
                }
                disabled={
                  placing
                }
                className="w-9 h-9 rounded-full bg-slate-100 grid place-items-center disabled:opacity-50"
              >
                ✕
              </button>

            </div>

            {/* ITEMS */}
            <div className="space-y-3 mb-4">

              {cartArr.map(
                (item) => (
                  <div
                    key={
                      item.product
                        .id
                    }
                    className="flex items-start gap-3"
                  >

                    <div className="w-14 h-14 rounded-xl bg-slate-100 overflow-hidden shrink-0 grid place-items-center text-2xl">

                      {item.product
                        .imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={
                            item.product
                              .imageUrl
                          }
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        item.product
                          .icon
                      )}

                    </div>

                    <div className="flex-1 min-w-0">

                      <div className="font-semibold text-sm">
                        {
                          item
                            .product
                            .name
                        }
                      </div>

                      <div className="text-xs text-slate-500">

                        {parseFloat(
                          item.product
                            .price,
                        ).toFixed(
                          2,
                        )}{" "}
                        ×{" "}
                        {
                          item.quantity
                        }{" "}
                        ={" "}
                        <b>
                          {(
                            item.quantity *
                            parseFloat(
                              item
                                .product
                                .price,
                            )
                          ).toFixed(
                            2,
                          )}
                        </b>

                      </div>

                      <input
                        type="text"
                        placeholder="Note (e.g. no sugar)"
                        value={
                          item.note
                        }
                        disabled={
                          placing
                        }
                        onChange={(
                          e,
                        ) =>
                          setNote(
                            item
                              .product
                              .id,
                            e.target
                              .value,
                          )
                        }
                        className="mt-1 w-full text-xs px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 disabled:opacity-50"
                      />

                    </div>

                    {/* QUANTITY */}
                    <div className="flex items-center gap-1">

                      <button
                        onClick={() =>
                          changeQty(
                            item
                              .product
                              .id,
                            -1,
                          )
                        }
                        disabled={
                          placing
                        }
                        className="w-8 h-8 rounded-lg bg-slate-100 font-bold disabled:opacity-50"
                      >
                        −
                      </button>

                      <span className="w-6 text-center font-bold">
                        {
                          item.quantity
                        }
                      </span>

                      <button
                        onClick={() =>
                          changeQty(
                            item
                              .product
                              .id,
                            1,
                          )
                        }
                        disabled={
                          placing
                        }
                        className="w-8 h-8 rounded-lg bg-slate-100 font-bold disabled:opacity-50"
                      >
                        +
                      </button>

                    </div>

                  </div>
                ),
              )}

            </div>

            {/* ORDER NOTE */}
            <textarea
              className="w-full p-3 rounded-xl border border-slate-200 text-sm resize-none disabled:opacity-50"
              rows={2}
              placeholder="Extra note for the whole order (optional)"
              value={
                customerNote
              }
              disabled={
                placing
              }
              maxLength={1000}
              onChange={(e) =>
                setWholeOrderNote(
                  e.target.value,
                )
              }
            />

            {/* TOTAL */}
            <div className="flex items-center justify-between py-3 border-t border-slate-100 mt-3">

              <span className="text-slate-600">
                Total
              </span>

              <span className="text-2xl font-bold tabular-nums text-indigo-700">
                {cartTotal.toFixed(
                  2,
                )}
              </span>

            </div>

            {/* ERROR */}
            {error && (
              <div className="mb-3 p-3 rounded-xl bg-red-50 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* PLACE ORDER */}
            <button
              onClick={
                placeOrder
              }
              disabled={
                placing ||
                !booking ||
                cartArr.length ===
                  0
              }
              className="w-full py-4 rounded-2xl bg-emerald-500 text-white font-bold text-lg shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {placing
                ? "Placing…"
                : !booking
                ? "Ask staff to check you in"
                : `Place order · ${cartTotal.toFixed(
                    2,
                  )}`}
            </button>

            <p className="text-xs text-slate-400 text-center mt-3">
              Items will be added to
              your table&apos;s bill.
              Pay at checkout.
            </p>

          </div>
        </div>
      )}

    </div>
  );
}