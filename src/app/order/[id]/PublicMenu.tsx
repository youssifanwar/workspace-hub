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
  const [loading, setLoading] = useState(true);

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

  const [needsConnection, setNeedsConnection] =
    useState(false);

  const [accessCode, setAccessCode] =
    useState("");

  const [connecting, setConnecting] =
    useState(false);

  const pendingRequestId =
    useRef<string | null>(null);

  /* ---------------------------------------------------------------------- */
  /* LOAD MENU                                                              */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    let cancelled = false;

    async function loadMenu() {
      setLoading(true);
      setError(null);

      try {
        const url =
          `/api/public/desks/${deskId}/menu`;

        console.log(
          "[PublicMenu] Loading:",
          url,
        );

        const controller =
          new AbortController();

        const timeout = window.setTimeout(
          () => {
            controller.abort();
          },
          10000,
        );

        const response =
          await fetch(url, {
            method: "GET",
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
          });

        window.clearTimeout(timeout);

        console.log(
          "[PublicMenu] Response:",
          response.status,
          response.ok,
        );

        const text =
          await response.text();

        console.log(
          "[PublicMenu] Response text length:",
          text.length,
        );

        if (cancelled) {
          return;
        }

        let data: any;

        try {
          data = JSON.parse(text);
        } catch {
          throw new Error(
            "The menu API returned invalid JSON.",
          );
        }

        if (!response.ok) {
          throw new Error(
            data?.error ||
              `Menu request failed (${response.status})`,
          );
        }

        if (!data?.desk) {
          throw new Error(
            "Menu API returned no desk data.",
          );
        }

        if (
          !Array.isArray(
            data.categories,
          )
        ) {
          throw new Error(
            "Menu API returned invalid categories data.",
          );
        }

        if (
          !Array.isArray(
            data.products,
          )
        ) {
          throw new Error(
            "Menu API returned invalid products data.",
          );
        }

        setDesk(data.desk);

        setBooking(
          data.booking ?? null,
        );

        setNeedsConnection(
          !data.booking,
        );

        setCategories(
          data.categories,
        );

        setProducts(
          data.products,
        );

        setActiveCat(
          data.categories.length > 0
            ? data.categories[0].id
            : null,
        );
      } catch (err) {
        console.error(
          "[PublicMenu] Load error:",
          err,
        );

        if (!cancelled) {
          if (
            err instanceof DOMException &&
            err.name === "AbortError"
          ) {
            setError(
              "Menu request timed out. Check the network connection.",
            );
          } else {
            setError(
              err instanceof Error
                ? err.message
                : "Could not load menu.",
            );
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadMenu();

    return () => {
      cancelled = true;
    };
  }, [deskId]);

  /* ---------------------------------------------------------------------- */
  /* CONNECT PHONE                                                          */
  /* ---------------------------------------------------------------------- */

  async function connectPhone(
    e: React.FormEvent,
  ) {
    e.preventDefault();

    if (connecting) {
      return;
    }

    const cleanCode =
      accessCode.trim();

    if (!/^\d{4}$/.test(cleanCode)) {
      setError(
        "Enter the 4-digit code given to you by staff.",
      );
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const res = await fetch(
        "/api/public/session/verify",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            accessCode: cleanCode,
          }),
        },
      );

      const data =
        await res.json().catch(
          () => null,
        );

      if (!res.ok) {
        setError(
          data?.error ||
            "Invalid or expired access code.",
        );

        setConnecting(false);
        return;
      }

      setAccessCode("");

      const menuRes =
        await fetch(
          `/api/public/desks/${deskId}/menu`,
          {
            cache: "no-store",
            credentials: "include",
          },
        );

      const menuData =
        await menuRes.json().catch(
          () => null,
        );

      if (!menuRes.ok) {
        setError(
          menuData?.error ||
            "Phone connected, but the menu could not be refreshed.",
        );

        setConnecting(false);
        return;
      }

      setDesk(menuData.desk);

      setBooking(
        menuData.booking ?? null,
      );

      setNeedsConnection(
        !menuData.booking,
      );

      setCategories(
        Array.isArray(
          menuData.categories,
        )
          ? menuData.categories
          : [],
      );

      setProducts(
        Array.isArray(
          menuData.products,
        )
          ? menuData.products
          : [],
      );

      setActiveCat(
        menuData.categories?.[0]?.id ??
          null,
      );
    } catch (err) {
      console.error(
        "[PublicMenu] Connect error:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Network error. Please try again.",
      );
    } finally {
      setConnecting(false);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* FILTER PRODUCTS                                                        */
  /* ---------------------------------------------------------------------- */

  const filtered = useMemo(
    () =>
      activeCat
        ? products.filter(
            (product) =>
              product.categoryId ===
              activeCat,
          )
        : products,
    [products, activeCat],
  );

  /* ---------------------------------------------------------------------- */
  /* CART                                                                   */
  /* ---------------------------------------------------------------------- */

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
          Number(item.product.price),
      0,
    );

  function invalidatePendingRequest() {
    if (!placing) {
      pendingRequestId.current =
        null;
    }
  }

  function addToCart(
    product: Product,
  ) {
    if (!booking) {
      setError(
        "Connect the phone to the active session first.",
      );
      return;
    }

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

  /* ---------------------------------------------------------------------- */
  /* PLACE ORDER                                                            */
  /* ---------------------------------------------------------------------- */

  async function placeOrder() {
    if (placing) {
      return;
    }

    if (!booking) {
      setError(
        "This phone is not connected to an active customer session.",
      );
      return;
    }

    if (cartArr.length === 0) {
      return;
    }

    setPlacing(true);
    setError(null);

    if (
      !pendingRequestId.current
    ) {
      pendingRequestId.current =
        createRequestId();
    }

    const requestId =
      pendingRequestId.current;

    try {
      const res =
        await fetch(
          `/api/public/desks/${deskId}/order`,
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
            },
            credentials: "include",
            body: JSON.stringify({
              requestId,

              customerNote:
                customerNote.trim(),

              items: cartArr.map(
                (item) => ({
                  productId:
                    item.product.id,

                  quantity:
                    item.quantity,

                  note:
                    item.note.trim(),
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
        if (
          res.status === 401
        ) {
          setBooking(null);
          setNeedsConnection(true);
        }

        setError(
          data.error ||
            "Could not place order.",
        );

        setPlacing(false);
        return;
      }

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

      setCart({});
      setCustomerNote("");
      setCartOpen(false);

      pendingRequestId.current =
        null;
    } catch (err) {
      console.error(
        "[PublicMenu] Place order error:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Network error. Please try again.",
      );
    } finally {
      setPlacing(false);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* LOADING                                                                */
  /* ---------------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-50 p-6">
        <div className="text-center">
          <div className="text-4xl mb-4">
            🍽️
          </div>

          <div className="text-slate-600 font-semibold">
            Loading menu…
          </div>

          <div className="text-xs text-slate-400 mt-2">
            Please wait
          </div>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /* INITIAL ERROR                                                          */
  /* ---------------------------------------------------------------------- */

  if (error && !desk) {
    return (
      <div className="min-h-screen grid place-items-center p-6 bg-slate-50">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">
            😕
          </div>

          <div className="font-bold text-lg text-slate-800">
            Could not load menu
          </div>

          <div className="text-sm text-red-600 mt-3 break-words">
            {error}
          </div>

          <button
            type="button"
            onClick={() =>
              window.location.reload()
            }
            className="mt-5 px-5 py-3 rounded-xl bg-indigo-600 text-white font-bold"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------------- */
  /* ORDER SUCCESS                                                           */
  /* ---------------------------------------------------------------------- */

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
            {placed.total.toFixed(2)}
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

  /* ---------------------------------------------------------------------- */
  /* MAIN PAGE                                                              */
  /* ---------------------------------------------------------------------- */

  return (
    <div className="min-h-screen bg-slate-50 pb-32">

      {/* HEADER */}

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
          <div className="mt-2 text-sm bg-amber-500/25 border border-amber-200/40 rounded-xl px-3 py-2">
            🔐 This phone is not
            connected to an active
            session.
          </div>
        )}
      </div>

      {/* CONNECTION */}

      {needsConnection && (
        <div className="mx-4 mt-4 p-5 rounded-2xl bg-white border border-amber-200 shadow-sm">
          <div className="font-bold text-slate-800 text-lg">
            Connect your phone
          </div>

          <div className="text-sm text-slate-500 mt-1">
            Enter the 4-digit code
            given to you by the staff
            when your session was
            started.
          </div>

          <form
            onSubmit={connectPhone}
            className="mt-4 space-y-3"
          >
            <input
              className="w-full px-4 py-4 rounded-2xl border border-slate-200 bg-slate-50 text-center text-3xl font-bold tracking-[0.45em] text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              value={accessCode}
              onChange={(e) =>
                setAccessCode(
                  e.target.value
                    .replace(
                      /\D/g,
                      "",
                    )
                    .slice(0, 4),
                )
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              placeholder="0000"
              disabled={connecting}
            />

            <button
              type="submit"
              disabled={
                connecting ||
                accessCode.length !== 4
              }
              className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-bold text-lg shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {connecting
                ? "Connecting…"
                : "Connect phone"}
            </button>
          </form>
        </div>
      )}

      {/* ERROR */}

      {error && desk && (
        <div className="mx-4 mt-3 p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* CATEGORY TABS */}

      <div className="sticky top-0 z-20 bg-slate-50/95 backdrop-blur border-b border-slate-200">
        <div className="flex gap-2 overflow-x-auto px-4 py-3">
          {categories.map(
            (category) => (
              <button
                key={category.id}
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
                  {category.icon}
                </span>

                {category.name}
              </button>
            ),
          )}
        </div>
      </div>

      {/* PRODUCTS */}

      <div className="p-4 grid grid-cols-2 gap-3">
        {filtered.map(
          (product) => {
            const inCart =
              cart[
                product.id
              ]?.quantity || 0;

            return (
              <button
                key={product.id}
                onClick={() =>
                  addToCart(
                    product,
                  )
                }
                disabled={
                  placing ||
                  !booking
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
                      {product.icon}
                    </div>
                  )}

                  {inCart > 0 && (
                    <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-indigo-600 text-white text-sm font-bold grid place-items-center shadow">
                      {inCart}
                    </div>
                  )}
                </div>

                <div className="p-3">
                  <div className="font-semibold text-sm text-slate-800 line-clamp-1">
                    {product.name}
                  </div>

                  <div className="flex items-center justify-between mt-1">
                    <div className="text-indigo-600 font-bold text-sm">
                      {Number(
                        product.price,
                      ).toFixed(2)}
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

      {/* CART BAR */}

      {cartCount > 0 && (
        <div className="fixed bottom-4 left-4 right-4 z-30">
          <button
            onClick={() =>
              setCartOpen(true)
            }
            disabled={
              !booking ||
              placing
            }
            className="w-full py-4 px-5 rounded-2xl bg-indigo-600 text-white font-bold shadow-2xl flex items-center justify-between disabled:opacity-60"
          >
            <span className="flex items-center gap-3">
              <span className="w-8 h-8 rounded-full bg-white/25 grid place-items-center text-sm">
                {cartCount}
              </span>

              View cart
            </span>

            <span className="tabular-nums">
              {cartTotal.toFixed(2)}
            </span>
          </button>
        </div>
      )}

      {/* CART DRAWER */}

      {cartOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50"
          onClick={() =>
            !placing &&
            setCartOpen(false)
          }
        >
          <div
            className="absolute bottom-0 inset-x-0 bg-white rounded-t-3xl p-5 max-h-[85vh] overflow-y-auto"
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
                  setCartOpen(false)
                }
                disabled={placing}
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
                            item
                              .product
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
                        {item.product.name}
                      </div>

                      <div className="text-xs text-slate-500">
                        {Number(
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
                            Number(
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
              value={customerNote}
              disabled={placing}
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
                {cartTotal.toFixed(2)}
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
                cartArr.length === 0
              }
              className="w-full py-4 rounded-2xl bg-emerald-500 text-white font-bold text-lg shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {placing
                ? "Placing…"
                : !booking
                ? "Connect phone first"
                : `Place order · ${cartTotal.toFixed(
                    2,
                  )}`}
            </button>

            <p className="text-xs text-slate-400 text-center mt-3">
              Items will be added to
              your session&apos;s bill.
              Pay at checkout.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}