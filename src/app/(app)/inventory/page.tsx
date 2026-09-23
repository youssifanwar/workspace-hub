"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Product = {
  id: number;
  categoryId: number;
  categoryName: string;
  name: string;
  price: string;
  icon: string;
  imageUrl: string | null;
  active: boolean;
  stockQuantity: number;
};

function money(value: string | number): string {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

export default function InventoryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/inventory/products", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || `Could not load inventory (HTTP ${response.status}).`);
      }

      const nextProducts = Array.isArray(data?.products) ? (data.products as Product[]) : [];
      setProducts(nextProducts);
      setDraft(
        Object.fromEntries(
          nextProducts.map((product) => [product.id, String(product.stockQuantity)]),
        ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load inventory.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => {
    return [...new Map(products.map((product) => [product.categoryId, {
      id: product.categoryId,
      name: product.categoryName,
    }])).values()];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return products.filter((product) => {
      const matchesCategory = category === null || product.categoryId === category;
      const matchesSearch = !query || product.name.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [category, products, search]);

  async function saveStock(product: Product) {
    const value = Number(draft[product.id]);

    if (!Number.isSafeInteger(value) || value < 0) {
      setError(`Invalid stock quantity for ${product.name}.`);
      return;
    }

    setSavingId(product.id);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/inventory/products", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          productId: product.id,
          stockQuantity: value,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data?.error || `Could not update stock (HTTP ${response.status}).`);
      }

      const updated = data?.product as { id?: number; stockQuantity?: number } | undefined;
      const nextStock = Number(updated?.stockQuantity ?? value);

      setProducts((current) =>
        current.map((item) =>
          item.id === product.id
            ? { ...item, stockQuantity: nextStock }
            : item,
        ),
      );
      setDraft((current) => ({ ...current, [product.id]: String(nextStock) }));
      setMessage(`Stock updated: ${product.name}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not update stock.");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-slate-500">Loading inventory…</div>;
  }

  return (
    <main className="p-4 lg:p-6 space-y-6">
      <div>
        <div className="text-xs uppercase tracking-wide text-indigo-600 font-bold">Inventory</div>
        <h1 className="text-3xl font-black text-slate-900 mt-1">F&amp;B Stock</h1>
        <p className="text-sm text-slate-500 mt-1">
          Set the real quantity available for each food and drink. QR orders and direct F&amp;B sales use this stock.
        </p>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>
      )}

      {message && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700">{message}</div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row gap-3">
          <input
            className="input flex-1"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search product…"
          />
          <select
            className="input lg:w-64"
            value={category === null ? "all" : String(category)}
            onChange={(event) => setCategory(event.target.value === "all" ? null : Number(event.target.value))}
          >
            <option value="all">All categories</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-3 pr-4">Product</th>
                <th className="py-3 pr-4">Category</th>
                <th className="py-3 pr-4">Price</th>
                <th className="py-3 pr-4">Stock</th>
                <th className="py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => (
                <tr key={product.id} className="border-b border-slate-100">
                  <td className="py-3 pr-4 font-bold text-slate-800">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">{product.icon}</span>
                      <span>{product.name}</span>
                    </div>
                  </td>
                  <td className="py-3 pr-4 text-slate-500">{product.categoryName}</td>
                  <td className="py-3 pr-4">{money(product.price)} EGP</td>
                  <td className="py-3 pr-4">
                    <input
                      className="input w-28"
                      type="number"
                      min="0"
                      step="1"
                      value={draft[product.id] ?? String(product.stockQuantity)}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, [product.id]: event.target.value }))
                      }
                    />
                  </td>
                  <td className="py-3">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={savingId === product.id}
                      onClick={() => void saveStock(product)}
                    >
                      {savingId === product.id ? "Saving…" : "Save"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredProducts.length === 0 && (
            <div className="py-10 text-center text-slate-500">No products found.</div>
          )}
        </div>
      </div>
    </main>
  );
}
