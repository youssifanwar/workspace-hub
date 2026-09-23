"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Product = {
  id: number;
  categoryId: number;
  categoryName: string;
  categoryIcon: string;
  name: string;
  price: string;
  icon: string;
  imageUrl: string | null;
  stockQuantity: number;
};

type Category = {
  id: number;
  name: string;
  icon: string;
};

type CartItem = {
  product: Product;
  quantity: number;
};

type SaleResult = {
  saleId: number;
  saleNumber: string;
  createdAt: string;
  subtotal: number;
  discount: number;
  total: number;
  paidAmount: number;
  changeAmount: number;
  paymentMethod: "cash" | "visa" | "instapay";
  note?: string | null;
  items: Array<{
    name: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
  }>;
};

function money(value: number | string): string {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

export default function FnbSalesPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [cart, setCart] = useState<Record<number, CartItem>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "visa" | "instapay">("cash");
  const [paidAmount, setPaidAmount] = useState("");
  const [saleNote, setSaleNote] = useState("");
  const [receipt, setReceipt] = useState<SaleResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/fnb/sales", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || `Could not load F&B menu (HTTP ${response.status}).`);
      }

      setProducts(Array.isArray(data?.products) ? data.products : []);
      setCategories(Array.isArray(data?.categories) ? data.categories : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load F&B menu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredProducts = useMemo(() => {
    if (activeCategory === null) {
      return products;
    }

    return products.filter((product) => product.categoryId === activeCategory);
  }, [activeCategory, products]);

  const cartItems = useMemo(() => Object.values(cart), [cart]);

  const cartTotal = useMemo(
    () =>
      cartItems.reduce(
        (sum, item) => sum + Number(item.product.price) * item.quantity,
        0,
      ),
    [cartItems],
  );

  const cartCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems],
  );

  function addProduct(product: Product) {
    if (product.stockQuantity <= 0) {
      return;
    }

    setError(null);
    setCart((current) => {
      const existing = current[product.id];
      const currentQty = existing?.quantity ?? 0;

      if (currentQty >= product.stockQuantity) {
        return current;
      }

      return {
        ...current,
        [product.id]: {
          product,
          quantity: currentQty + 1,
        },
      };
    });
  }

  function changeQuantity(productId: number, delta: number) {
    setCart((current) => {
      const existing = current[productId];
      if (!existing) {
        return current;
      }

      const nextQuantity = existing.quantity + delta;

      if (nextQuantity <= 0) {
        const next = { ...current };
        delete next[productId];
        return next;
      }

      if (nextQuantity > existing.product.stockQuantity) {
        return current;
      }

      return {
        ...current,
        [productId]: {
          ...existing,
          quantity: nextQuantity,
        },
      };
    });
  }

  function setAllInStockProduct(stockQuantity: number) {
    return Math.max(0, Number.isFinite(stockQuantity) ? stockQuantity : 0);
  }

  async function completeSale() {
    if (saving || cartItems.length === 0) {
      return;
    }

    const paid = Number(paidAmount);

    if (!Number.isFinite(paid) || paid < cartTotal) {
      setError(`Paid amount must be at least ${money(cartTotal)} EGP.`);
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/fnb/sales", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          paymentMethod,
          paidAmount: paid,
          note: saleNote.trim(),
          items: cartItems.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
          })),
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || `Could not complete sale (HTTP ${response.status}).`);
      }

      setReceipt(data.sale as SaleResult);
      setCart({});
      setPaidAmount("");
      setSaleNote("");
      await load();
    } catch (saleError) {
      setError(saleError instanceof Error ? saleError.message : "Could not complete sale.");
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-slate-500">Loading F&B POS…</div>;
  }

  return (
    <main className="p-4 lg:p-6 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-indigo-600 font-bold">F&amp;B</div>
          <h1 className="text-3xl font-black text-slate-900 mt-1">Direct F&amp;B Sale</h1>
          <p className="text-sm text-slate-500 mt-1">
            Sell food and drinks without opening a customer session or assigning a desk.
          </p>
        </div>

        <div className="rounded-2xl bg-white border border-slate-200 px-4 py-3 shadow-sm">
          <div className="text-xs text-slate-500">Cart</div>
          <div className="text-2xl font-black text-slate-900">{cartCount}</div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_390px] gap-6 items-start">
        <section className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap ${
                activeCategory === null
                  ? "bg-indigo-600 text-white"
                  : "bg-white border border-slate-200 text-slate-700"
              }`}
            >
              All
            </button>

            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                onClick={() => setActiveCategory(category.id)}
                className={`px-4 py-2 rounded-full text-sm font-bold whitespace-nowrap ${
                  activeCategory === category.id
                    ? "bg-indigo-600 text-white"
                    : "bg-white border border-slate-200 text-slate-700"
                }`}
              >
                {category.icon} {category.name}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-4 gap-4">
            {filteredProducts.map((product) => {
              const inCart = cart[product.id]?.quantity ?? 0;
              const stock = setAllInStockProduct(product.stockQuantity);
              const outOfStock = stock <= 0;
              const atLimit = inCart >= stock;

              return (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addProduct(product)}
                  disabled={saving || outOfStock || atLimit}
                  className="text-left rounded-3xl border border-slate-200 bg-white overflow-hidden shadow-sm hover:shadow-md transition disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <div className="aspect-square bg-slate-100 relative overflow-hidden">
                    {product.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.imageUrl} alt={product.name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full grid place-items-center text-6xl">{product.icon}</div>
                    )}

                    <div className="absolute top-3 right-3 rounded-full bg-white/95 px-3 py-1 text-xs font-black text-slate-700 shadow">
                      Stock {stock}
                    </div>

                    {inCart > 0 && (
                      <div className="absolute top-3 left-3 rounded-full bg-indigo-600 text-white w-8 h-8 grid place-items-center font-black">
                        {inCart}
                      </div>
                    )}
                  </div>

                  <div className="p-4">
                    <div className="font-black text-slate-900 line-clamp-1">{product.name}</div>
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <div className="text-indigo-600 font-black">{money(product.price)} EGP</div>
                      <div className="text-xs font-bold text-slate-400">
                        {outOfStock ? "Out of Stock" : atLimit ? "Stock Limit" : "Add +"}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="sticky top-4 rounded-3xl border border-slate-200 bg-white shadow-lg overflow-hidden">
          <div className="p-5 border-b border-slate-100">
            <div className="text-xs uppercase tracking-wide text-indigo-600 font-bold">Current Sale</div>
            <h2 className="text-2xl font-black text-slate-900 mt-1">Walk-in Customer</h2>
            <p className="text-sm text-slate-500 mt-1">No session · No desk</p>
          </div>

          <div className="p-5 space-y-4 max-h-[55vh] overflow-auto">
            {cartItems.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-200 p-8 text-center text-slate-500">
                Cart is empty.
              </div>
            ) : (
              cartItems.map((item) => (
                <div key={item.product.id} className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-slate-100 grid place-items-center text-2xl shrink-0">
                    {item.product.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-slate-900 line-clamp-1">{item.product.name}</div>
                    <div className="text-sm text-slate-500">{money(item.product.price)} EGP</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" className="w-8 h-8 rounded-lg border" onClick={() => changeQuantity(item.product.id, -1)}>-</button>
                    <div className="w-7 text-center font-black">{item.quantity}</div>
                    <button
                      type="button"
                      className="w-8 h-8 rounded-lg border"
                      onClick={() => changeQuantity(item.product.id, 1)}
                      disabled={item.quantity >= item.product.stockQuantity}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="p-5 border-t border-slate-100 space-y-4">
            <div className="flex items-center justify-between text-lg">
              <span className="text-slate-500">Total</span>
              <span className="font-black text-slate-900">{money(cartTotal)} EGP</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(["cash", "visa", "instapay"] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  onClick={() => setPaymentMethod(method)}
                  className={`rounded-xl border px-3 py-3 text-sm font-bold ${
                    paymentMethod === method
                      ? "border-indigo-600 bg-indigo-50 text-indigo-700"
                      : "border-slate-200 text-slate-700"
                  }`}
                >
                  {method === "cash" ? "Cash" : method === "visa" ? "Visa" : "InstaPay"}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="fnb-paid-amount">
                Paid Amount
              </label>
              <input
                id="fnb-paid-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={paidAmount}
                onChange={(event) => setPaidAmount(event.target.value)}
                className="input w-full text-lg font-black"
                placeholder={money(cartTotal)}
                disabled={saving || cartItems.length === 0}
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2" htmlFor="fnb-sale-note">
                Note (optional)
              </label>
              <textarea
                id="fnb-sale-note"
                rows={2}
                value={saleNote}
                onChange={(event) => setSaleNote(event.target.value)}
                className="input w-full resize-none"
                placeholder="Optional sale note"
                disabled={saving}
              />
            </div>

            <button
              type="button"
              onClick={() => void completeSale()}
              disabled={saving || cartItems.length === 0}
              className="btn btn-primary w-full py-4 text-base font-black"
            >
              {saving ? "Completing Sale…" : "Complete Sale"}
            </button>
          </div>
        </aside>
      </div>

      {receipt && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 text-center">
              <div className="text-sm font-bold text-emerald-600">Sale Completed</div>
              <div className="text-3xl font-black text-slate-900 mt-1">{receipt.saleNumber}</div>
            </div>

            <div className="p-6 space-y-4">
              <div className="space-y-2">
                {receipt.items.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="flex items-center justify-between gap-4 text-sm">
                    <div className="min-w-0">
                      <div className="font-bold text-slate-900">{item.name}</div>
                      <div className="text-slate-500">{item.quantity} × {money(item.unitPrice)}</div>
                    </div>
                    <div className="font-black text-slate-900">{money(item.lineTotal)}</div>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-200 pt-4 space-y-2">
                <div className="flex justify-between text-slate-500"><span>Total</span><span>{money(receipt.total)} EGP</span></div>
                <div className="flex justify-between text-slate-500"><span>Paid</span><span>{money(receipt.paidAmount)} EGP</span></div>
                <div className="flex justify-between text-lg font-black text-slate-900"><span>Change</span><span>{money(receipt.changeAmount)} EGP</span></div>
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 grid grid-cols-2 gap-3">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setReceipt(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => router.push(`/fnb/invoice/${receipt.saleId}`)}
              >
                Invoice / Print
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
