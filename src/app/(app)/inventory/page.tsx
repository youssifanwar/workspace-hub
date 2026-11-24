"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageBar, StatStrip, Panel } from "../_components/ui";
import { useFmt } from "@/lib/lang-context";

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
  const f = useFmt();
  const tx = f.t;
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
        throw new Error(data?.error || (f.en ? `Could not load inventory (HTTP ${response.status}).` : `مقدرناش نحمّل المخزون (HTTP ${response.status}).`));
      }

      const nextProducts = Array.isArray(data?.products) ? (data.products as Product[]) : [];
      setProducts(nextProducts);
      setDraft(
        Object.fromEntries(
          nextProducts.map((product) => [product.id, String(product.stockQuantity)]),
        ),
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : tx("Could not load inventory."));
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
      setError((f.en ? `Invalid stock quantity for ${product.name}.` : `كمية مخزون غير صحيحة لـ ${product.name}.`));
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
        throw new Error(data?.error || (f.en ? `Could not update stock (HTTP ${response.status}).` : `مقدرناش نحدّث المخزون (HTTP ${response.status}).`));
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
      setMessage((f.en ? `Stock updated: ${product.name}` : `تم تحديث المخزون: ${product.name}`));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : tx("Could not update stock."));
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return <div className="min-h-screen grid place-items-center text-slate-500">{tx("Loading inventory…")}</div>;
  }

  const lowCount = products.filter((p) => p.stockQuantity > 0 && p.stockQuantity <= 5).length;
  const outCount = products.filter((p) => p.stockQuantity <= 0).length;

  return (
    <div>
      <PageBar
        crumb={tx("Inventory")}
        title={f.en ? "F&B Stock" : "مخزون الأكل والشرب"}
        description={f.en ? "Set the real quantity available for each food and drink. QR orders and direct F&B sales use this stock." : "حدد الكمية الفعلية المتاحة من كل أكل ومشروب. طلبات QR والبيع المباشر بيستخدموا المخزون ده."}
      />

      <StatStrip
        items={[
          { label: tx("Products"), value: products.length, tone: "brand" },
          { label: tx("Low stock"), value: lowCount, hint: f.en ? "5 or fewer left" : "باقي 5 أو أقل", tone: "amber" },
          { label: tx("Out of stock"), value: outCount, tone: "red" },
        ]}
      />

      {error && <div className="v2-alert red">{error}</div>}
      {message && <div className="v2-alert green">{message}</div>}

      <Panel flush>
        <div className="v2-toolbar">
          <input
            className="input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={tx("Search product…")}
          />
          <div className="v2-chips">
            <button
              type="button"
              className={`v2-chip ${category === null ? "on" : ""}`}
              onClick={() => setCategory(null)}
            >
              {tx("All categories")}
            </button>
            {categories.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`v2-chip ${category === item.id ? "on" : ""}`}
                onClick={() => setCategory(item.id)}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>

        <div className="x-table-wrap">
          <table className="v2-tbl">
            <thead>
              <tr>
                <th>{tx("Product")}</th>
                <th>{tx("Category")}</th>
                <th>{tx("Price")}</th>
                <th>{tx("Status")}</th>
                <th>{tx("Stock")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => (
                <tr key={product.id}>
                  <td>
                    <div className="v2-prod">
                      <span className="v2-prod-ico">{product.icon}</span>
                      <b>{product.name}</b>
                    </div>
                  </td>
                  <td className="muted">{product.categoryName}</td>
                  <td className="num" style={{ textAlign: "start" }}>{f.money(product.price)}</td>
                  <td>
                    {product.stockQuantity <= 0 ? (
                      <span className="v2-tag red">{tx("Out of stock")}</span>
                    ) : product.stockQuantity <= 5 ? (
                      <span className="v2-tag amber">{tx("Low stock")}</span>
                    ) : (
                      <span className="v2-tag green">{tx("In stock")}</span>
                    )}
                  </td>
                  <td>
                    <input
                      className="input"
                      style={{ width: 96 }}
                      type="number"
                      min="0"
                      step="1"
                      value={draft[product.id] ?? String(product.stockQuantity)}
                      onChange={(event) =>
                        setDraft((current) => ({ ...current, [product.id]: event.target.value }))
                      }
                    />
                  </td>
                  <td style={{ textAlign: "end" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={savingId === product.id}
                      onClick={() => void saveStock(product)}
                    >
                      {savingId === product.id ? tx("Saving…") : tx("Save")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredProducts.length === 0 && (
            <div className="v2-empty">{tx("No products found.")}</div>
          )}
        </div>
      </Panel>
    </div>
  );
}
