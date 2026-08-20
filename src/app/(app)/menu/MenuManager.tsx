"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Category = { id: number; name: string; icon: string };
type Product = {
  id: number;
  categoryId: number;
  name: string;
  price: string;
  imageUrl: string | null;
  icon: string;
};

const EMOJI_CHOICES = ["🍔","🍕","🥪","🌮","🥙","🍟","🥐","🥨","🧁","🍰","🍪","🍩","🍫","🍿","☕","🥛","🍵","🧃","🥤","🧊","🍹","🍺","🥂","🍷","🍊","🍎","🍌","💧"];
const ICON_CATEGORY = ["☕","🧊","🍔","🍽️","🍰","🍪","🥤","🥗","🍕","🍿","🥂","🍹"];

export default function MenuManager({
  categories,
  products,
  currency,
  canManage,
}: {
  categories: Category[];
  products: Product[];
  currency: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [activeCat, setActiveCat] = useState<number | "all">(categories[0]?.id ?? "all");
  const [addingProduct, setAddingProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [addingCat, setAddingCat] = useState(false);
  const [editingCat, setEditingCat] = useState<Category | null>(null);

  const filtered = useMemo(
    () =>
      activeCat === "all"
        ? products
        : products.filter((p) => p.categoryId === activeCat),
    [products, activeCat],
  );

  async function deleteProduct(p: Product) {
    if (!confirm(`Delete "${p.name}"?`)) return;
    const res = await fetch(`/api/products/${p.id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  async function deleteCategory(c: Category) {
    if (!confirm(`Delete category "${c.name}" and all its products?`)) return;
    const res = await fetch(`/api/categories/${c.id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 overflow-x-auto scroll-fade pb-1">
        <button
          onClick={() => setActiveCat("all")}
          className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap ${
            activeCat === "all"
              ? "bg-slate-900 text-white"
              : "bg-white border border-slate-200"
          }`}
        >
          All ({products.length})
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            onDoubleClick={() => canManage && setEditingCat(c)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition ${
              activeCat === c.id
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/30"
                : "bg-white border border-slate-200 text-slate-700 hover:border-indigo-300"
            }`}
            title={canManage ? "Double-click to edit" : ""}
          >
            <span className="mr-1">{c.icon}</span>
            {c.name}
          </button>
        ))}
        {canManage && (
          <button
            onClick={() => setAddingCat(true)}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-dashed border-slate-300 text-slate-500 hover:border-indigo-400 hover:text-indigo-600"
          >
            + Category
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {canManage && (
          <button
            onClick={() => setAddingProduct(true)}
            className="aspect-square rounded-2xl border-2 border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50 transition grid place-items-center text-slate-500 hover:text-indigo-600"
          >
            <div className="text-center">
              <div className="text-4xl">+</div>
              <div className="text-sm font-semibold mt-1">Add product</div>
            </div>
          </button>
        )}
        {filtered.map((p) => (
          <div
            key={p.id}
            className="group aspect-square rounded-2xl bg-white border border-slate-200 overflow-hidden flex flex-col hover:-translate-y-0.5 hover:border-indigo-300 transition relative"
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
              {canManage && (
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition grid place-items-center gap-2">
                  <button
                    onClick={() => setEditingProduct(p)}
                    className="btn btn-primary !py-1.5 !px-3 text-xs"
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => deleteProduct(p)}
                    className="btn btn-danger !py-1.5 !px-3 text-xs"
                  >
                    🗑 Delete
                  </button>
                </div>
              )}
            </div>
            <div className="p-2.5">
              <div className="font-semibold text-sm text-slate-800 truncate">
                {p.name}
              </div>
              <div className="text-xs text-indigo-600 font-bold">
                {parseFloat(p.price).toFixed(2)} {currency}
              </div>
            </div>
          </div>
        ))}
      </div>

      {addingProduct && (
        <ProductModal
          categories={categories}
          currency={currency}
          onClose={() => setAddingProduct(false)}
          onSaved={() => {
            setAddingProduct(false);
            router.refresh();
          }}
        />
      )}
      {editingProduct && (
        <ProductModal
          categories={categories}
          currency={currency}
          product={editingProduct}
          onClose={() => setEditingProduct(null)}
          onSaved={() => {
            setEditingProduct(null);
            router.refresh();
          }}
        />
      )}
      {addingCat && (
        <CategoryModal
          onClose={() => setAddingCat(false)}
          onSaved={() => {
            setAddingCat(false);
            router.refresh();
          }}
        />
      )}
      {editingCat && (
        <CategoryModal
          category={editingCat}
          onClose={() => setEditingCat(null)}
          onSaved={() => {
            setEditingCat(null);
            router.refresh();
          }}
          onDelete={() => {
            deleteCategory(editingCat);
            setEditingCat(null);
          }}
        />
      )}
    </div>
  );
}

function ProductModal({
  categories,
  currency,
  product,
  onClose,
  onSaved,
}: {
  categories: Category[];
  currency: string;
  product?: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product?.name || "");
  const [price, setPrice] = useState(product?.price || "0");
  const [categoryId, setCategoryId] = useState<number>(
    product?.categoryId || categories[0]?.id || 0,
  );
  const [icon, setIcon] = useState(product?.icon || "🍔");
  const [imageUrl, setImageUrl] = useState(product?.imageUrl || "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(f: File | null) {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      setError("Image must be under 2MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImageUrl(String(reader.result));
    reader.readAsDataURL(f);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const url = product ? `/api/products/${product.id}` : "/api/products";
    const method = product ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        categoryId,
        name: name.trim(),
        price: parseFloat(price) || 0,
        icon,
        imageUrl: imageUrl || null,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed");
      setLoading(false);
      return;
    }
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
      <div className="card w-full max-w-md p-6 max-h-[92vh] overflow-y-auto scroll-fade">
        <div className="flex items-start justify-between mb-4">
          <h3 className="text-xl font-bold">
            {product ? "Edit product" : "Add product"}
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 grid place-items-center"
          >
            ✕
          </button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-20 h-20 rounded-2xl bg-slate-100 grid place-items-center text-4xl overflow-hidden shrink-0">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imageUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                icon
              )}
            </div>
            <div className="flex-1 space-y-2">
              <label className="btn btn-ghost text-xs cursor-pointer w-full">
                📷 Upload image
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onFile(e.target.files?.[0] || null)}
                />
              </label>
              <input
                className="input text-xs"
                placeholder="…or paste image URL"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="label">Emoji icon</label>
            <div className="flex flex-wrap gap-1">
              {EMOJI_CHOICES.map((e) => (
                <button
                  type="button"
                  key={e}
                  onClick={() => setIcon(e)}
                  className={`w-9 h-9 rounded-lg grid place-items-center text-lg transition ${
                    icon === e
                      ? "bg-indigo-600 shadow-lg scale-110"
                      : "bg-slate-100 hover:bg-slate-200"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Price ({currency})</label>
              <input
                className="input"
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="label">Category</label>
              <select
                className="select"
                value={categoryId}
                onChange={(e) => setCategoryId(parseInt(e.target.value))}
              >
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon} {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn btn-ghost flex-1">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary flex-1" disabled={loading}>
              {loading ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CategoryModal({
  category,
  onClose,
  onSaved,
  onDelete,
}: {
  category?: Category;
  onClose: () => void;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(category?.name || "");
  const [icon, setIcon] = useState(category?.icon || "🍽️");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const url = category ? `/api/categories/${category.id}` : "/api/categories";
    const method = category ? "PATCH" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), icon }),
    });
    if (res.ok) onSaved();
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
      <div className="card w-full max-w-sm p-6">
        <h3 className="text-xl font-bold mb-4">
          {category ? "Edit category" : "New category"}
        </h3>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">Icon</label>
            <div className="flex flex-wrap gap-1">
              {ICON_CATEGORY.map((e) => (
                <button
                  type="button"
                  key={e}
                  onClick={() => setIcon(e)}
                  className={`w-10 h-10 rounded-lg grid place-items-center text-xl ${
                    icon === e ? "bg-indigo-600" : "bg-slate-100"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          </div>
          <div className="flex gap-2 pt-2">
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="btn btn-danger"
              >
                🗑
              </button>
            )}
            <button type="button" onClick={onClose} className="btn btn-ghost flex-1">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary flex-1" disabled={loading}>
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
