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
  // false when the manager has paused ordering for this product.
  // (Stock levels are internal and never sent to customers.)
  orderable: boolean;
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

  const [search, setSearch] = useState("");

  const [cart, setCart] =
    useState<Record<number, CartItem>>({});

  const [cartOpen, setCartOpen] =
    useState(false);

  const [customerNote, setCustomerNote] =
    useState("");

  const [placing, setPlacing] =
    useState(false);

  const [placed, setPlaced] = useState<{
    ticketNumber: number;
    total: number;
  } | null>(null);

  const [needsConnection, setNeedsConnection] =
    useState(false);

  const [connectionCode, setConnectionCode] =
    useState("");

  const [connecting, setConnecting] =
    useState(false);

  const [reloadKey, setReloadKey] =
    useState(0);

  // ---------------------------------------------------------------------------
  // IMPORTANT:
  // Keep the same requestId when retrying the exact same order.
  // ---------------------------------------------------------------------------

  const pendingRequestId =
    useRef<string | null>(null);

  // ---------------------------------------------------------------------------
  // LOAD MENU
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, 8000);

    async function load() {
      try {
        setLoading(true);
        setError(null);
        setNeedsConnection(false);

        const res = await fetch(
          `/api/public/desks/${deskId}/menu`,
          {
            cache: "no-store",
            credentials: "include",
            signal: controller.signal,
            headers: {
              Accept: "application/json",
            },
          },
        );

        const text = await res.text();

        if (cancelled) {
          return;
        }

        let data: any = null;

        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new Error(
            "The menu API returned invalid JSON.",
          );
        }

        if (!res.ok) {
          throw new Error(
            data?.error ||
              `Failed to load menu (HTTP ${res.status}).`,
          );
        }

        if (!data?.desk) {
          throw new Error(
            "Menu API returned no desk data.",
          );
        }

        if (!Array.isArray(data.categories)) {
          throw new Error(
            "Menu API returned invalid categories data.",
          );
        }

        if (!Array.isArray(data.products)) {
          throw new Error(
            "Menu API returned invalid products data.",
          );
        }

        setDesk(data.desk);

        // Booking is the customer's active session,
        // independent from the physical QR location.
        setBooking(data.booking ?? null);
        setNeedsConnection(!data.booking);
        setCategories(data.categories);
        setProducts(data.products);
        setActiveCat(
          data.categories.length > 0
            ? data.categories[0].id
            : null,
        );
      } catch (err) {
        if (cancelled) {
          return;
        }

        console.error(
          "[PublicMenu] Load error:",
          err,
        );

        if (
          err instanceof DOMException &&
          err.name === "AbortError"
        ) {
          setError(
            "Menu request timed out after 8 seconds. Check that the server and database are reachable.",
          );
        } else {
          setError(
            err instanceof Error
              ? err.message
              : "Could not load menu.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [deskId, reloadKey]);

  // ---------------------------------------------------------------------------
  // CONNECT PHONE
  // ---------------------------------------------------------------------------

  async function connectPhone() {
    if (connecting) return;

    if (!/^\d{4}$/.test(connectionCode)) {
      setError("اكتب الكود المكوّن من 4 أرقام.");
      return;
    }

    setConnecting(true);
    setError(null);

    try {
      const res = await fetch("/api/public/session/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          accessCode: connectionCode,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(
          data?.error ||
            "مقدرناش نربط التليفون.",
        );
        setConnecting(false);
        return;
      }

      setConnectionCode("");
      setConnecting(false);
      setReloadKey((value) => value + 1);
    } catch {
      setError("مشكلة في الاتصال. جرّب تاني.");
      setConnecting(false);
    }
  }

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
    if (!booking) {
      setError("اربط التليفون بالجلسة الشغالة الأول.");
      return;
    }

    if (!product.orderable) {
      setError(`${product.name} مش متاح للطلب دلوقتي.`);
      return;
    }

    setError(null);
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
    if (placing) {
      return;
    }

    if (!booking) {
      setError(
        "التليفون ده مش مربوط بجلسة شغالة.",
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
            "مقدرناش نسجّل الطلب",
        );

        // Availability may have changed while the cart was open. Refresh the
        // menu so the customer sees the latest state immediately.
        if (res.status === 409) {
          setReloadKey((key) => key + 1);
        }

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
    } catch {
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
      <div className="q-wrap grid place-items-center" style={{ color: "#64748b", fontWeight: 700 }}>
        بنحمّل المنيو…
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // INITIAL ERROR
  // ---------------------------------------------------------------------------

  if (error && !desk) {
    return (
      <div className="q-wrap grid place-items-center p-6">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-3">😕</div>
          <div className="font-bold text-lg">{error}</div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // ORDER SUCCESS
  // ---------------------------------------------------------------------------

  if (placed) {
    return (
      <div className="q-wrap">
        <div className="q-body" style={{ marginTop: 0, paddingTop: 48, textAlign: "center" }}>
          <div style={{ width: 84, height: 84, borderRadius: 24, background: "linear-gradient(135deg,#10b981,#047857)", color: "#fff", display: "grid", placeItems: "center", fontSize: 42, margin: "0 auto 16px", boxShadow: "0 14px 30px rgba(5,150,105,.3)" }}>✓</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: "0 0 6px" }}>طلبك اتسجّل!</h1>
          <p style={{ color: "#64748b", margin: "0 0 16px" }}>الباريستا استلم الطلب وهيجهّزه.</p>
          <div style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <span className="x-pill" style={{ background: "#0f172a", color: "#fff", padding: "8px 14px", fontSize: 15 }}>#{String(placed.ticketNumber).padStart(3, "0")}</span>
            {desk && <span className="x-pill" style={{ padding: "8px 14px", fontSize: 14 }}>{desk.name}{booking ? ` · ${booking.customerName}` : ""}</span>}
          </div>
          <div className="q-card" style={{ textAlign: "start", marginTop: 20 }}>
            <div className="x-row-sub">إجمالي الطلب</div>
            <div style={{ fontSize: 30, fontWeight: 800 }} className="x-num">{placed.total.toFixed(2)} <small style={{ fontSize: 14, color: "#64748b" }}>ج.م</small></div>
            <div className="x-note" style={{ background: "#eff6ff", borderColor: "#bfdbfe", color: "#1e40af" }}>هيتحسب على فاتورة جلستك وتدفعه وقت الخروج.</div>
          </div>
          <button onClick={() => setPlaced(null)} className="x-btn dark block" style={{ marginTop: 16, padding: "14px" }}>اطلب حاجة تانية</button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // MAIN PAGE
  // ---------------------------------------------------------------------------

  const visible = filtered.filter((p) => !search.trim() || p.name.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="q-wrap">
      <div className="q-hero">
        <div className="q-hero-row">
          <div className="q-logo"><i>WS</i><span>ورك سبيس هب</span></div>
          <span className="q-place">📍 {desk?.name}</span>
        </div>
        <h1>عطشان؟ ☕</h1>
        <p>اطلب من مكانك وهيوصلك للمكتب</p>
      </div>

      <div className="q-body">
        <input className="q-search" type="search" placeholder="دوّر على مشروبك أو سناك..." value={search} onChange={(e) => setSearch(e.target.value)} />

        {booking ? (
          <div className="q-status">
            <div className="x-row-title">👤 {booking.customerName} · الجلسة شغالة</div>
            <div className="x-row-sub">الطلبات هتتضاف على فاتورة جلستك.</div>
          </div>
        ) : (
          <div className="q-status" style={{ background: "#fffbeb", borderColor: "#fde68a" }}>
            <div className="x-row-title" style={{ color: "#92400e" }}>🔐 اكتب كود الجلسة (4 أرقام) عشان تربط التليفون.</div>
          </div>
        )}

        {needsConnection && (
          <div className="q-card">
            <div className="x-row-title">🔐 اربط تليفونك</div>
            <div className="x-row-sub">اكتب الكود المكوّن من 4 أرقام اللي اديهولك الموظف.</div>
            <div className="flex gap-2" style={{ marginTop: 12 }}>
              <input
                className="q-search"
                style={{ textAlign: "center", fontSize: 24, fontWeight: 800, letterSpacing: ".35em", boxShadow: "none" }}
                value={connectionCode}
                onChange={(e) => setConnectionCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                placeholder="0000"
                disabled={connecting}
                dir="ltr"
              />
              <button type="button" onClick={connectPhone} disabled={connecting || connectionCode.length !== 4} className="x-btn primary">
                {connecting ? "بيتصل…" : "اتصل"}
              </button>
            </div>
            {error && <div className="x-note" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }}>{error}</div>}
          </div>
        )}

        {!needsConnection && error && (
          <div className="x-note" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b", marginTop: 12 }}>{error}</div>
        )}

        <div className="q-cats">
          <button type="button" className={`q-cat ${activeCat === null ? "active" : ""}`} onClick={() => setActiveCat(null)}>الكل</button>
          {categories.map((category) => (
            <button key={category.id} type="button" onClick={() => setActiveCat(category.id)} className={`q-cat ${activeCat === category.id ? "active" : ""}`}>
              {category.icon} {category.name}
            </button>
          ))}
        </div>

        <div className="q-grid">
          {visible.map((product) => {
            const inCart = cart[product.id]?.quantity || 0;
            return (
              <div key={product.id} className={`q-item ${product.orderable ? "" : "off"}`}>
                <div className="q-thumb">
                  {product.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={product.imageUrl} alt={product.name} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 12 }} />
                  ) : (
                    product.icon
                  )}
                </div>
                {!product.orderable && <span className="q-off-tag">اتوقف مؤقتاً</span>}
                <div className="q-name">{product.name}</div>
                <div className="q-price-row">
                  <span className="q-price x-num">{parseFloat(product.price).toFixed(0)} ج.م</span>
                  {inCart > 0 && product.orderable ? (
                    <span className="q-stepper">
                      <button type="button" aria-label="قلّل" disabled={placing} onClick={() => changeQty(product.id, -1)}>−</button>
                      <span className="x-num">{inCart}</span>
                      <button type="button" aria-label="زوّد" disabled={placing || !booking} onClick={() => changeQty(product.id, 1)}>+</button>
                    </span>
                  ) : (
                    <button type="button" className="q-add" aria-label={`أضف ${product.name}`} disabled={placing || !booking || !product.orderable} onClick={() => addToCart(product)} style={!booking || !product.orderable ? { background: "#cbd5e1" } : undefined}>+</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        {visible.length === 0 && <div className="x-empty">مفيش نتايج.</div>}
      </div>

      {cartCount > 0 && !cartOpen && (
        <div className="q-cart">
          <div>
            <b className="x-num">{cartTotal.toFixed(0)} ج.م</b>
            <small>{cartCount} أصناف في السلة</small>
          </div>
          <button type="button" className="x-btn" onClick={() => setCartOpen(true)} disabled={!booking || placing}>مراجعة الطلب ←</button>
        </div>
      )}

      {cartOpen && (
        <div className="fixed inset-0 z-40" style={{ background: "rgba(15,23,42,.55)" }} onClick={() => !placing && setCartOpen(false)}>
          <div className="absolute bottom-0 inset-x-0 bg-white overflow-y-auto" style={{ borderRadius: "24px 24px 0 0", padding: 20, maxHeight: "88vh", maxWidth: 640, margin: "0 auto" }} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div style={{ fontSize: 20, fontWeight: 800 }}>طلبك</div>
              <button onClick={() => setCartOpen(false)} disabled={placing} className="x-iconbtn" aria-label="إغلاق">✕</button>
            </div>

            <div className="x-list">
              {cartArr.map((item) => (
                <div key={item.product.id} className="x-row" style={{ alignItems: "flex-start" }}>
                  <span className="x-kpi-ico tone-amber" style={{ width: 48, height: 48, fontSize: 24, flexShrink: 0 }}>{item.product.icon}</span>
                  <div className="x-row-main">
                    <div className="x-row-title">{item.product.name}</div>
                    <div className="x-row-sub x-num">{parseFloat(item.product.price).toFixed(0)} × {item.quantity} = <b>{(item.quantity * parseFloat(item.product.price)).toFixed(0)} ج.م</b></div>
                    <input type="text" placeholder="ملاحظة (مثلاً: من غير سكر)" value={item.note} disabled={placing} onChange={(e) => setNote(item.product.id, e.target.value)} style={{ marginTop: 6, width: "100%", fontSize: 13, padding: "6px 10px", borderRadius: 10, background: "#f8fafc", border: "1px solid #e2e8f0" }} />
                  </div>
                  <span className="q-stepper">
                    <button type="button" onClick={() => changeQty(item.product.id, -1)} disabled={placing} aria-label="قلّل">−</button>
                    <span className="x-num">{item.quantity}</span>
                    <button type="button" onClick={() => changeQty(item.product.id, 1)} disabled={placing} aria-label="زوّد">+</button>
                  </span>
                </div>
              ))}
            </div>

            <textarea className="q-search" style={{ marginTop: 12, boxShadow: "none", resize: "none", fontSize: 14 }} rows={2} placeholder="ملاحظة على الطلب كله (اختياري)" value={customerNote} disabled={placing} maxLength={1000} onChange={(e) => setWholeOrderNote(e.target.value)} />

            <div className="flex items-center justify-between" style={{ padding: "14px 0 8px" }}>
              <span style={{ color: "#64748b", fontWeight: 700 }}>الإجمالي</span>
              <span style={{ fontSize: 26, fontWeight: 800, color: "#1d4ed8" }} className="x-num">{cartTotal.toFixed(0)} ج.م</span>
            </div>

            {error && <div className="x-note" style={{ background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b", marginBottom: 10 }}>{error}</div>}

            <button onClick={placeOrder} disabled={placing || !booking || cartArr.length === 0} className="x-btn success block" style={{ padding: 16, fontSize: 17 }}>
              {placing ? "بنبعت الطلب…" : !booking ? "اربط التليفون الأول" : `إرسال الطلب · ${cartTotal.toFixed(0)} ج.م`}
            </button>
            <p className="x-row-sub" style={{ textAlign: "center", marginTop: 10 }}>الأصناف هتتضاف على فاتورة جلستك وتدفع عند الخروج.</p>
          </div>
        </div>
      )}
    </div>
  );
}
