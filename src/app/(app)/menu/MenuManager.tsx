"use client";

import {
  useMemo,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";

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

type ApiResponse = {
  error?: string;
};

const EMOJI_CHOICES = [
  "🍔",
  "🍕",
  "🥪",
  "🌮",
  "🥙",
  "🍟",
  "🥐",
  "🥨",
  "🧁",
  "🍰",
  "🍪",
  "🍩",
  "🍫",
  "🍿",
  "☕",
  "🥛",
  "🍵",
  "🧃",
  "🥤",
  "🧊",
  "🍹",
  "🍺",
  "🥂",
  "🍷",
  "🍊",
  "🍎",
  "🍌",
  "💧",
] as const;

const ICON_CATEGORY = [
  "☕",
  "🧊",
  "🍔",
  "🍽️",
  "🍰",
  "🍪",
  "🥤",
  "🥗",
  "🍕",
  "🍿",
  "🥂",
  "🍹",
] as const;

function safeNumber(
  value: string | number | null | undefined,
) {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseFloat(value ?? "0");

  return Number.isFinite(parsed)
    ? parsed
    : 0;
}

function isValidImageUrl(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return true;
  }

  if (trimmed.startsWith("data:image/")) {
    return true;
  }

  try {
    const url = new URL(trimmed);

    return (
      url.protocol === "http:" ||
      url.protocol === "https:"
    );
  } catch {
    return false;
  }
}

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

  const [activeCat, setActiveCat] = useState<
    number | "all"
  >(categories[0]?.id ?? "all");

  const [addingProduct, setAddingProduct] =
    useState(false);

  const [editingProduct, setEditingProduct] =
    useState<Product | null>(null);

  const [addingCat, setAddingCat] =
    useState(false);

  const [editingCat, setEditingCat] =
    useState<Category | null>(null);

  const [busy, setBusy] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const filtered = useMemo(
    () =>
      activeCat === "all"
        ? products
        : products.filter(
            (product) =>
              product.categoryId === activeCat,
          ),
    [products, activeCat],
  );

  function clearError() {
    setError(null);
  }

  async function deleteProduct(product: Product) {
    if (busy) {
      return;
    }

    const confirmed = window.confirm(
      `Delete "${product.name}"?`,
    );

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/products/${product.id}`,
        {
          method: "DELETE",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        },
      );

      const data =
        (await res
          .json()
          .catch(() => null)) as
          | ApiResponse
          | null;

      if (!res.ok) {
        setError(
          data?.error ||
            "Failed to delete the product.",
        );
        return;
      }

      if (
        activeCat !== "all" &&
        products.filter(
          (item) =>
            item.id !== product.id &&
            item.categoryId === activeCat,
        ).length === 0
      ) {
        setActiveCat("all");
      }

      router.refresh();
    } catch (err) {
      console.error(
        "Delete product failed:",
        err,
      );

      setError(
        "Could not connect to the server. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function deleteCategory(
    category: Category,
  ) {
    if (busy) {
      return;
    }

    const hasProducts =
      products.some(
        (product) =>
          product.categoryId === category.id,
      );

    if (hasProducts) {
      setError(
        "This category cannot be deleted while it still contains products. Move or delete its products first.",
      );
      return;
    }

    const confirmed = window.confirm(
      `Delete category "${category.name}"?`,
    );

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/categories/${category.id}`,
        {
          method: "DELETE",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        },
      );

      const data =
        (await res
          .json()
          .catch(() => null)) as
          | ApiResponse
          | null;

      if (!res.ok) {
        setError(
          data?.error ||
            "Failed to delete the category.",
        );
        return;
      }

      if (activeCat === category.id) {
        setActiveCat("all");
      }

      setEditingCat(null);
      router.refresh();
    } catch (err) {
      console.error(
        "Delete category failed:",
        err,
      );

      setError(
        "Could not connect to the server. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ERROR */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}

          <button
            type="button"
            onClick={clearError}
            className="ml-2 font-semibold underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* CATEGORIES */}
      <div className="flex items-center gap-2 overflow-x-auto scroll-fade pb-1">
        <button
          type="button"
          onClick={() => {
            setActiveCat("all");
            clearError();
          }}
          className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap ${
            activeCat === "all"
              ? "bg-slate-900 text-white"
              : "bg-white border border-slate-200 hover:border-slate-300"
          }`}
          aria-pressed={
            activeCat === "all"
          }
        >
          All ({products.length})
        </button>

        {categories.map((category) => {
          const categoryProductCount =
            products.filter(
              (product) =>
                product.categoryId ===
                category.id,
            ).length;

          return (
            <button
              type="button"
              key={category.id}
              onClick={() => {
                setActiveCat(category.id);
                clearError();
              }}
              onDoubleClick={() =>
                canManage &&
                setEditingCat(category)
              }
              className={`px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition ${
                activeCat === category.id
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/30"
                  : "bg-white border border-slate-200 text-slate-700 hover:border-indigo-300"
              }`}
              title={
                canManage
                  ? "Double-click to edit"
                  : category.name
              }
              aria-pressed={
                activeCat === category.id
              }
            >
              <span
                className="mr-1"
                aria-hidden="true"
              >
                {category.icon}
              </span>

              {category.name}

              <span className="ml-1 opacity-70">
                ({categoryProductCount})
              </span>
            </button>
          );
        })}

        {canManage && (
          <button
            type="button"
            onClick={() => {
              clearError();
              setAddingCat(true);
            }}
            disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-semibold bg-white border-2 border-dashed border-slate-300 text-slate-500 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-50"
          >
            + Category
          </button>
        )}
      </div>

      {/* PRODUCTS */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {canManage && (
          <button
            type="button"
            onClick={() => {
              clearError();
              setAddingProduct(true);
            }}
            disabled={busy}
            className="aspect-square rounded-2xl border-2 border-dashed border-slate-300 hover:border-indigo-400 hover:bg-indigo-50 transition grid place-items-center text-slate-500 hover:text-indigo-600 disabled:opacity-50"
          >
            <div className="text-center">
              <div className="text-4xl">
                +
              </div>

              <div className="text-sm font-semibold mt-1">
                Add product
              </div>
            </div>
          </button>
        )}

        {filtered.map((product) => (
          <div
            key={product.id}
            className="group aspect-square rounded-2xl bg-white border border-slate-200 overflow-hidden flex flex-col hover:-translate-y-0.5 hover:border-indigo-300 transition relative"
          >
            <div className="flex-1 bg-slate-100 relative overflow-hidden">
              {product.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div
                  className="w-full h-full grid place-items-center text-5xl"
                  aria-hidden="true"
                >
                  {product.icon}
                </div>
              )}

              <div
                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/95 text-lg grid place-items-center shadow"
                aria-hidden="true"
              >
                {product.icon}
              </div>

              {canManage && (
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition grid place-items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      clearError();
                      setEditingProduct(product);
                    }}
                    disabled={busy}
                    className="btn btn-primary !py-1.5 !px-3 text-xs disabled:opacity-50"
                  >
                    ✏️ Edit
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      void deleteProduct(
                        product,
                      )
                    }
                    disabled={busy}
                    className="btn btn-danger !py-1.5 !px-3 text-xs disabled:opacity-50"
                  >
                    🗑 Delete
                  </button>
                </div>
              )}
            </div>

            <div className="p-2.5">
              <div className="font-semibold text-sm text-slate-800 truncate">
                {product.name}
              </div>

              <div className="text-xs text-indigo-600 font-bold">
                {safeNumber(
                  product.price,
                ).toFixed(2)}{" "}
                {currency}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* EMPTY STATE */}
      {filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-200 py-12 text-center text-slate-400">
          <div className="text-4xl mb-2">
            🍽️
          </div>

          <div className="font-semibold">
            No products in this category
          </div>

          {canManage && (
            <div className="text-xs mt-1">
              Add a product to get started.
            </div>
          )}
        </div>
      )}

      {/* PRODUCT MODALS */}
      {addingProduct && (
        <ProductModal
          categories={categories}
          currency={currency}
          onClose={() =>
            setAddingProduct(false)
          }
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
          onClose={() =>
            setEditingProduct(null)
          }
          onSaved={() => {
            setEditingProduct(null);
            router.refresh();
          }}
        />
      )}

      {/* CATEGORY MODALS */}
      {addingCat && (
        <CategoryModal
          onClose={() =>
            setAddingCat(false)
          }
          onSaved={() => {
            setAddingCat(false);
            router.refresh();
          }}
        />
      )}

      {editingCat && (
        <CategoryModal
          category={editingCat}
          onClose={() =>
            setEditingCat(null)
          }
          onSaved={() => {
            setEditingCat(null);
            router.refresh();
          }}
          onDelete={() =>
            void deleteCategory(
              editingCat,
            )
          }
        />
      )}
    </div>
  );
}

// =============================================================================
// PRODUCT MODAL
// =============================================================================

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
  const [name, setName] = useState(
    product?.name ?? "",
  );

  const [price, setPrice] = useState(
    product?.price ?? "",
  );

  const [categoryId, setCategoryId] =
    useState<number>(
      product?.categoryId ??
        categories[0]?.id ??
        0,
    );

  const [icon, setIcon] = useState(
    product?.icon ?? "🍔",
  );

  const [imageUrl, setImageUrl] = useState(
    product?.imageUrl ?? "",
  );

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  function validate() {
    const trimmedName =
      name.trim();

    if (!trimmedName) {
      return "Product name is required.";
    }

    if (trimmedName.length > 200) {
      return "Product name is too long.";
    }

    const numericPrice =
      Number(price);

    if (
      !Number.isFinite(
        numericPrice,
      ) ||
      numericPrice <= 0
    ) {
      return "Enter a valid price greater than 0.";
    }

    if (
      numericPrice >
      9999999999.99
    ) {
      return "Price is too large.";
    }

    if (
      !Number.isSafeInteger(
        categoryId,
      ) ||
      categoryId <= 0 ||
      !categories.some(
        (category) =>
          category.id ===
          categoryId,
      )
    ) {
      return "Select a valid category.";
    }

    if (
      !icon ||
      icon.length > 20
    ) {
      return "Select a valid icon.";
    }

    if (
      imageUrl.trim().length >
      4_000_000
    ) {
      return "Image data is too large.";
    }

    if (
      !isValidImageUrl(
        imageUrl,
      )
    ) {
      return "Enter a valid image URL.";
    }

    return null;
  }

  function onFile(
    file: File | null,
  ) {
    if (!file) {
      return;
    }

    if (
      !file.type.startsWith(
        "image/",
      )
    ) {
      setError(
        "Please select an image file.",
      );
      return;
    }

    if (
      file.size >
      2 * 1024 * 1024
    ) {
      setError(
        "Image must be under 2MB.",
      );
      return;
    }

    setError(null);

    const reader =
      new FileReader();

    reader.onload = () => {
      const result =
        String(
          reader.result ?? "",
        );

      if (
        !result.startsWith(
          "data:image/",
        )
      ) {
        setError(
          "Could not read the selected image.",
        );
        return;
      }

      setImageUrl(result);
    };

    reader.onerror = () => {
      setError(
        "Could not read the selected image.",
      );
    };

    reader.readAsDataURL(file);
  }

  async function submit(
    e: FormEvent<HTMLFormElement>,
  ) {
    e.preventDefault();

    if (loading) {
      return;
    }

    setError(null);

    const validation =
      validate();

    if (validation) {
      setError(validation);
      return;
    }

    setLoading(true);

    try {
      const url = product
        ? `/api/products/${product.id}`
        : "/api/products";

      const method = product
        ? "PATCH"
        : "POST";

      const res = await fetch(
        url,
        {
          method,
          headers: {
            "Content-Type":
              "application/json",
            Accept:
              "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            categoryId,
            name: name.trim(),
            price: Number(price),
            icon,
            imageUrl:
              imageUrl.trim() ||
              null,
          }),
        },
      );

      const data =
        (await res
          .json()
          .catch(() => null)) as
          | ApiResponse
          | null;

      if (!res.ok) {
        setError(
          data?.error ||
            "Failed to save the product.",
        );
        return;
      }

      onSaved();
    } catch (err) {
      console.error(
        "Save product failed:",
        err,
      );

      setError(
        "Could not connect to the server. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-modal-title"
    >
      <div className="card w-full max-w-md p-6 max-h-[92vh] overflow-y-auto scroll-fade">
        <div className="flex items-start justify-between mb-4">
          <h3
            id="product-modal-title"
            className="text-xl font-bold"
          >
            {product
              ? "Edit product"
              : "Add product"}
          </h3>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 grid place-items-center"
            aria-label="Close"
            disabled={loading}
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={submit}
          className="space-y-3"
          noValidate
        >
          {/* IMAGE */}
          <div className="flex items-center gap-3">
            <div className="w-20 h-20 rounded-2xl bg-slate-100 grid place-items-center text-4xl overflow-hidden shrink-0">
              {imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={imageUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <span aria-hidden="true">
                  {icon}
                </span>
              )}
            </div>

            <div className="flex-1 space-y-2">
              <label
                className={`btn btn-ghost text-xs cursor-pointer w-full ${
                  loading
                    ? "opacity-50 pointer-events-none"
                    : ""
                }`}
              >
                📷 Upload image

                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                  className="hidden"
                  disabled={loading}
                  onChange={(
                    event: ChangeEvent<HTMLInputElement>,
                  ) => {
                    void onFile(
                      event.target
                        .files?.[0] ??
                        null,
                    );

                    event.target.value =
                      "";
                  }}
                />
              </label>

              <input
                className="input text-xs"
                placeholder="…or paste image URL"
                value={imageUrl}
                onChange={(e) => {
                  setImageUrl(
                    e.target.value,
                  );
                  setError(null);
                }}
                maxLength={4_000_000}
                disabled={loading}
              />
            </div>
          </div>

          {/* ICON */}
          <div>
            <label className="label">
              Emoji icon
            </label>

            <div className="flex flex-wrap gap-1">
              {EMOJI_CHOICES.map(
                (emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    onClick={() => {
                      setIcon(emoji);
                      setError(null);
                    }}
                    disabled={loading}
                    aria-pressed={
                      icon === emoji
                    }
                    className={`w-9 h-9 rounded-lg grid place-items-center text-lg transition ${
                      icon === emoji
                        ? "bg-indigo-600 shadow-lg scale-110"
                        : "bg-slate-100 hover:bg-slate-200"
                    } disabled:opacity-50`}
                  >
                    {emoji}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* NAME */}
          <div>
            <label
              htmlFor="product-name"
              className="label"
            >
              Name
            </label>

            <input
              id="product-name"
              name="name"
              className="input"
              value={name}
              onChange={(e) => {
                setName(
                  e.target.value,
                );
                setError(null);
              }}
              maxLength={200}
              required
              autoFocus
              disabled={loading}
            />
          </div>

          {/* PRICE + CATEGORY */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="product-price"
                className="label"
              >
                Price ({currency})
              </label>

              <input
                id="product-price"
                name="price"
                className="input"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                max="9999999999.99"
                value={price}
                onChange={(e) => {
                  setPrice(
                    e.target.value,
                  );
                  setError(null);
                }}
                required
                disabled={loading}
              />
            </div>

            <div>
              <label
                htmlFor="product-category"
                className="label"
              >
                Category
              </label>

              <select
                id="product-category"
                name="categoryId"
                className="select"
                value={categoryId}
                onChange={(e) => {
                  const value =
                    Number(
                      e.target.value,
                    );

                  setCategoryId(value);
                  setError(null);
                }}
                disabled={
                  loading ||
                  categories.length === 0
                }
              >
                {categories.length ===
                0 ? (
                  <option value={0}>
                    No categories
                  </option>
                ) : (
                  categories.map(
                    (category) => (
                      <option
                        key={category.id}
                        value={category.id}
                      >
                        {category.icon}{" "}
                        {category.name}
                      </option>
                    ),
                  )
                )}
              </select>
            </div>
          </div>

          {/* ERROR */}
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {/* ACTIONS */}
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost flex-1"
              disabled={loading}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="btn btn-primary flex-1"
              disabled={
                loading ||
                categories.length === 0
              }
              aria-busy={loading}
            >
              {loading
                ? "Saving…"
                : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// =============================================================================
// CATEGORY MODAL
// =============================================================================

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
  const [name, setName] = useState(
    category?.name ?? "",
  );

  const [icon, setIcon] = useState(
    category?.icon ?? "🍽️",
  );

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  function validate() {
    const trimmedName =
      name.trim();

    if (!trimmedName) {
      return "Category name is required.";
    }

    if (trimmedName.length > 100) {
      return "Category name is too long.";
    }

    if (!icon || icon.length > 20) {
      return "Select a valid icon.";
    }

    return null;
  }

  async function submit(
    e: FormEvent<HTMLFormElement>,
  ) {
    e.preventDefault();

    if (loading) {
      return;
    }

    setError(null);

    const validation =
      validate();

    if (validation) {
      setError(validation);
      return;
    }

    setLoading(true);

    try {
      const url = category
        ? `/api/categories/${category.id}`
        : "/api/categories";

      const method = category
        ? "PATCH"
        : "POST";

      const res = await fetch(
        url,
        {
          method,
          headers: {
            "Content-Type":
              "application/json",
            Accept:
              "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            name: name.trim(),
            icon,
          }),
        },
      );

      const data =
        (await res
          .json()
          .catch(() => null)) as
          | ApiResponse
          | null;

      if (!res.ok) {
        setError(
          data?.error ||
            "Failed to save the category.",
        );
        return;
      }

      onSaved();
    } catch (err) {
      console.error(
        "Save category failed:",
        err,
      );

      setError(
        "Could not connect to the server. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-modal-title"
    >
      <div className="card w-full max-w-sm p-6">
        <div className="flex items-start justify-between mb-4">
          <h3
            id="category-modal-title"
            className="text-xl font-bold"
          >
            {category
              ? "Edit category"
              : "New category"}
          </h3>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 grid place-items-center"
            aria-label="Close"
            disabled={loading}
          >
            ✕
          </button>
        </div>

        <form
          onSubmit={submit}
          className="space-y-3"
          noValidate
        >
          {/* ICON */}
          <div>
            <label className="label">
              Icon
            </label>

            <div className="flex flex-wrap gap-1">
              {ICON_CATEGORY.map(
                (emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    onClick={() => {
                      setIcon(emoji);
                      setError(null);
                    }}
                    disabled={loading}
                    aria-pressed={
                      icon === emoji
                    }
                    className={`w-10 h-10 rounded-lg grid place-items-center text-xl transition ${
                      icon === emoji
                        ? "bg-indigo-600 text-white shadow-lg"
                        : "bg-slate-100 hover:bg-slate-200"
                    } disabled:opacity-50`}
                  >
                    {emoji}
                  </button>
                ),
              )}
            </div>
          </div>

          {/* NAME */}
          <div>
            <label
              htmlFor="category-name"
              className="label"
            >
              Name
            </label>

            <input
              id="category-name"
              name="name"
              className="input"
              value={name}
              onChange={(e) => {
                setName(
                  e.target.value,
                );
                setError(null);
              }}
              maxLength={100}
              required
              autoFocus
              disabled={loading}
            />
          </div>

          {/* ERROR */}
          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700"
            >
              {error}
            </div>
          )}

          {/* ACTIONS */}
          <div className="flex gap-2 pt-2">
            {onDelete && (
              <button
                type="button"
                onClick={() => {
                  if (!loading) {
                    onDelete();
                  }
                }}
                className="btn btn-danger"
                disabled={loading}
                title="Delete category"
                aria-label="Delete category"
              >
                🗑
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="btn btn-ghost flex-1"
              disabled={loading}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="btn btn-primary flex-1"
              disabled={loading}
              aria-busy={loading}
            >
              {loading
                ? "Saving…"
                : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}