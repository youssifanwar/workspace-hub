"use client";

import { useEffect, useState } from "react";

type SubscriptionPackage = {
  id: number;
  name: string;
  totalHours: number;
  price: number;
  validityDays: number | null;
  description: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type FormState = {
  name: string;
  totalHours: string;
  price: string;
  validityDays: string;
  description: string;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  totalHours: "",
  price: "",
  validityDays: "",
  description: "",
  active: true,
};

export default function SubscriptionPackagesPage() {
  const [packages, setPackages] =
    useState<SubscriptionPackage[]>(
      [],
    );

  const [loading, setLoading] =
    useState(true);

  const [saving, setSaving] =
    useState(false);

  const [showInactive, setShowInactive] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [success, setSuccess] =
    useState<string | null>(null);

  const [form, setForm] =
    useState<FormState>(
      EMPTY_FORM,
    );

  const [editingId, setEditingId] =
    useState<number | null>(null);

  // ===========================================================================
  // LOAD
  // ===========================================================================

  async function loadPackages() {
    setLoading(true);
    setError(null);

    try {
      const res =
        await fetch(
          "/api/subscription-packages",
          {
            cache: "no-store",
          },
        );

      const data =
        await res.json().catch(
          () => null,
        );

      if (!res.ok) {
        throw new Error(
          data?.error ||
            "Could not load packages.",
        );
      }

      setPackages(
        data?.packages ?? [],
      );
    } catch (err) {
      console.error(
        "Load packages error:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Could not load packages.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPackages();
  }, []);

  // ===========================================================================
  // FORM
  // ===========================================================================

  function updateField(
    key: keyof FormState,
    value:
      | string
      | boolean,
  ) {
    setForm((prev) => ({
      ...prev,
      [key]: value,
    }));

    setError(null);
    setSuccess(null);
  }

  function resetForm() {
    setForm(
      EMPTY_FORM,
    );

    setEditingId(null);
    setError(null);
    setSuccess(null);
  }

  function editPackage(
    pkg: SubscriptionPackage,
  ) {
    setEditingId(
      pkg.id,
    );

    setForm({
      name:
        pkg.name,

      totalHours:
        String(
          pkg.totalHours,
        ),

      price:
        String(
          pkg.price,
        ),

      validityDays:
        pkg.validityDays === null
          ? ""
          : String(
              pkg.validityDays,
            ),

      description:
        pkg.description ??
        "",

      active:
        pkg.active,
    });

    setError(null);
    setSuccess(null);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  // ===========================================================================
  // VALIDATION
  // ===========================================================================

  function validateForm() {
    const name =
      form.name.trim();

    const totalHours =
      Number(
        form.totalHours,
      );

    const price =
      Number(
        form.price,
      );

    const validityDays =
      form.validityDays.trim()
        ? Number(
            form.validityDays,
          )
        : null;

    if (!name) {
      return "Package name is required.";
    }

    if (
      !Number.isFinite(
        totalHours,
      ) ||
      totalHours <= 0
    ) {
      return "Total hours must be greater than zero.";
    }

    if (
      !Number.isFinite(
        price,
      ) ||
      price < 0
    ) {
      return "Price must be zero or greater.";
    }

    if (
      validityDays !==
        null &&
      (
        !Number.isInteger(
          validityDays,
        ) ||
        validityDays <= 0
      )
    ) {
      return "Validity days must be a positive whole number.";
    }

    return null;
  }

  // ===========================================================================
  // SAVE
  // ===========================================================================

  async function savePackage(
    e: React.FormEvent,
  ) {
    e.preventDefault();

    if (saving) {
      return;
    }

    setError(null);
    setSuccess(null);

    const validationError =
      validateForm();

    if (validationError) {
      setError(
        validationError,
      );
      return;
    }

    setSaving(true);

    try {
      const payload = {
        name:
          form.name.trim(),

        totalHours:
          Number(
            form.totalHours,
          ),

        price:
          Number(
            form.price,
          ),

        validityDays:
          form.validityDays.trim()
            ? Number(
                form.validityDays,
              )
            : null,

        description:
          form.description.trim() ||
          null,

        active:
          form.active,
      };

      const url =
        editingId === null
          ? "/api/subscription-packages"
          : `/api/subscription-packages/${editingId}`;

      const method =
        editingId === null
          ? "POST"
          : "PATCH";

      const res =
        await fetch(
          url,
          {
            method,

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify(
              payload,
            ),
          },
        );

      const data =
        await res.json().catch(
          () => null,
        );

      if (!res.ok) {
        throw new Error(
          data?.error ||
            "Could not save package.",
        );
      }

      setSuccess(
        editingId === null
          ? "Package created successfully."
          : "Package updated successfully.",
      );

      resetForm();

      await loadPackages();
    } catch (err) {
      console.error(
        "Save package error:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Could not save package.",
      );
    } finally {
      setSaving(false);
    }
  }

  // ===========================================================================
  // TOGGLE ACTIVE
  // ===========================================================================

  async function toggleActive(
    pkg: SubscriptionPackage,
  ) {
    if (saving) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res =
        await fetch(
          `/api/subscription-packages/${pkg.id}`,
          {
            method: "PATCH",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              active:
                !pkg.active,
            }),
          },
        );

      const data =
        await res.json().catch(
          () => null,
        );

      if (!res.ok) {
        throw new Error(
          data?.error ||
            "Could not change package status.",
        );
      }

      setSuccess(
        pkg.active
          ? "Package deactivated."
          : "Package activated.",
      );

      await loadPackages();
    } catch (err) {
      console.error(
        "Toggle package error:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Could not change package status.",
      );
    } finally {
      setSaving(false);
    }
  }

  // ===========================================================================
  // DELETE
  // ===========================================================================

  async function deletePackage(
    pkg: SubscriptionPackage,
  ) {
    if (saving) {
      return;
    }

    const confirmed =
      window.confirm(
        pkg.active
          ? `Deactivate "${pkg.name}"?`
          : `Remove "${pkg.name}" if it has never been sold?`,
      );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res =
        await fetch(
          `/api/subscription-packages/${pkg.id}`,
          {
            method: "DELETE",
          },
        );

      const data =
        await res.json().catch(
          () => null,
        );

      if (!res.ok) {
        throw new Error(
          data?.error ||
            "Could not remove package.",
        );
      }

      if (data?.deactivated) {
        setPackages((current) =>
          current.map((item) =>
            item.id === pkg.id
              ? { ...item, active: false }
              : item,
          ),
        );

        setSuccess(
          "Package archived because it has historical purchases. Its history is preserved.",
        );
      } else {
        setPackages((current) =>
          current.filter((item) => item.id !== pkg.id),
        );

        setSuccess("Package deleted.");
      }

      if (editingId === pkg.id) {
        resetForm();
      }

      await loadPackages();
    } catch (err) {
      console.error(
        "Delete package error:",
        err,
      );

      setError(
        err instanceof Error
          ? err.message
          : "Could not remove package.",
      );
    } finally {
      setSaving(false);
    }
  }

  const visiblePackages = showInactive
    ? packages
    : packages.filter((pkg) => pkg.active);

  const inactiveCount = packages.filter(
    (pkg) => !pkg.active,
  ).length;

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    <div className="space-y-6">

      {/* HEADER */}

      <div className="flex items-start justify-between gap-4 flex-wrap">

        <div>
          <div className="text-xs uppercase tracking-wide text-indigo-600 font-semibold">
            Subscriptions
          </div>

          <h1 className="text-3xl font-bold text-slate-900 mt-1">
            Subscription Packages
          </h1>

          <p className="text-slate-500 mt-1">
            Create and manage the packages
            customers can purchase.
          </p>
        </div>

        <div className="px-4 py-2 rounded-xl bg-indigo-50 text-indigo-700 font-semibold text-sm">
          {packages.length}{" "}
          {packages.length === 1
            ? "package"
            : "packages"}
        </div>

      </div>

      {/* MESSAGES */}

      {error && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">
          {success}
        </div>
      )}

      {/* CREATE / EDIT FORM */}

      <div className="card p-6">

        <div className="flex items-center justify-between gap-3 mb-5">

          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {editingId === null
                ? "Create package"
                : "Edit package"}
            </h2>

            <p className="text-sm text-slate-500 mt-1">
              The values entered here become
              the package definition for future
              purchases.
            </p>
          </div>

          {editingId !== null && (
            <button
              type="button"
              onClick={resetForm}
              className="btn btn-ghost"
              disabled={saving}
            >
              Cancel edit
            </button>
          )}

        </div>

        <form
          onSubmit={savePackage}
          className="grid md:grid-cols-2 gap-4"
        >

          {/* NAME */}

          <div className="md:col-span-2">
            <label className="label">
              Package name
            </label>

            <input
              className="input"
              value={form.name}
              onChange={(e) =>
                updateField(
                  "name",
                  e.target.value,
                )
              }
              placeholder="e.g. 60 Hours"
              disabled={saving}
            />
          </div>

          {/* HOURS */}

          <div>
            <label className="label">
              Total hours
            </label>

            <input
              className="input"
              type="number"
              min="0.01"
              step="0.01"
              value={
                form.totalHours
              }
              onChange={(e) =>
                updateField(
                  "totalHours",
                  e.target.value,
                )
              }
              placeholder="60"
              disabled={saving}
            />
          </div>

          {/* PRICE */}

          <div>
            <label className="label">
              Price
            </label>

            <input
              className="input"
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(e) =>
                updateField(
                  "price",
                  e.target.value,
                )
              }
              placeholder="1500"
              disabled={saving}
            />
          </div>

          {/* VALIDITY */}

          <div>
            <label className="label">
              Validity
            </label>

            <input
              className="input"
              type="number"
              min="1"
              step="1"
              value={
                form.validityDays
              }
              onChange={(e) =>
                updateField(
                  "validityDays",
                  e.target.value,
                )
              }
              placeholder="30"
              disabled={saving}
            />

            <p className="text-xs text-slate-400 mt-1">
              Leave empty for no expiry.
            </p>
          </div>

          {/* ACTIVE */}

          <div className="flex items-center gap-3 pt-7">
            <input
              id="package-active"
              type="checkbox"
              checked={form.active}
              onChange={(e) =>
                updateField(
                  "active",
                  e.target.checked,
                )
              }
              disabled={saving}
              className="w-4 h-4"
            />

            <label
              htmlFor="package-active"
              className="text-sm font-semibold text-slate-700"
            >
              Available for new purchases
            </label>
          </div>

          {/* DESCRIPTION */}

          <div className="md:col-span-2">
            <label className="label">
              Description
            </label>

            <textarea
              className="input min-h-24 resize-y"
              value={
                form.description
              }
              onChange={(e) =>
                updateField(
                  "description",
                  e.target.value,
                )
              }
              placeholder="Optional package details..."
              disabled={saving}
            />
          </div>

          {/* ACTIONS */}

          <div className="md:col-span-2 flex gap-2 pt-2">

            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving
                ? "Saving…"
                : editingId === null
                  ? "Create package"
                  : "Save changes"}
            </button>

            {editingId !== null && (
              <button
                type="button"
                onClick={resetForm}
                className="btn btn-ghost"
                disabled={saving}
              >
                Cancel
              </button>
            )}

          </div>

        </form>
      </div>

      {/* PACKAGE LIST */}

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm text-slate-500">
          {showInactive
            ? "Showing active and inactive packages."
            : "Showing active packages only."}
        </div>

        {inactiveCount > 0 && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowInactive((current) => !current)}
            disabled={saving}
          >
            {showInactive
              ? "Hide inactive packages"
              : `Show inactive packages (${inactiveCount})`}
          </button>
        )}
      </div>

      <div className="card overflow-hidden">

        <div className="p-5 border-b border-slate-200">
          <h2 className="text-xl font-bold text-slate-900">
            Package definitions
          </h2>

          <p className="text-sm text-slate-500 mt-1">
            Changing these values affects
            future purchases only. Historical
            customer subscriptions keep their
            original price and hours.
          </p>
        </div>

        {loading ? (
          <div className="p-10 text-center text-slate-500">
            Loading packages…
          </div>
        ) : visiblePackages.length ===
          0 ? (
          <div className="p-10 text-center">

            <div className="text-5xl mb-3">
              📦
            </div>

            <h3 className="font-bold text-slate-900">
              No packages yet
            </h3>

            <p className="text-sm text-slate-500 mt-1">
              Create your first subscription
              package above.
            </p>

          </div>
        ) : (
          <div className="divide-y divide-slate-200">

            {visiblePackages.map((pkg) => (
              <div
                key={pkg.id}
                className="p-5"
              >

                <div className="flex items-start justify-between gap-4 flex-wrap">

                  <div className="min-w-0">

                    <div className="flex items-center gap-2 flex-wrap">

                      <h3 className="text-lg font-bold text-slate-900">
                        {pkg.name}
                      </h3>

                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold ${
                          pkg.active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {pkg.active
                          ? "Active"
                          : "Inactive"}
                      </span>

                    </div>

                    {pkg.description && (
                      <p className="text-sm text-slate-500 mt-1">
                        {
                          pkg.description
                        }
                      </p>
                    )}

                  </div>

                  <div className="flex gap-2 flex-wrap">

                    <button
                      type="button"
                      onClick={() =>
                        editPackage(
                          pkg,
                        )
                      }
                      className="btn btn-ghost"
                      disabled={saving}
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void toggleActive(
                          pkg,
                        )
                      }
                      className="btn btn-ghost"
                      disabled={saving}
                    >
                      {pkg.active
                        ? "Deactivate"
                        : "Activate"}
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void deletePackage(
                          pkg,
                        )
                      }
                      className="btn btn-ghost text-red-600"
                      disabled={saving}
                    >
                      Delete
                    </button>

                  </div>

                </div>

                {/* DETAILS */}

                <div className="grid sm:grid-cols-3 gap-3 mt-4">

                  <InfoCard
                    label="Hours"
                    value={`${formatNumber(
                      pkg.totalHours,
                    )} h`}
                  />

                  <InfoCard
                    label="Price"
                    value={formatNumber(
                      pkg.price,
                    )}
                  />

                  <InfoCard
                    label="Validity"
                    value={
                      pkg.validityDays ===
                      null
                        ? "No expiry"
                        : `${pkg.validityDays} days`
                    }
                  />

                </div>

              </div>
            ))}

          </div>
        )}

      </div>

    </div>
  );
}

// =============================================================================
// INFO CARD
// =============================================================================

function InfoCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-slate-50 border border-slate-200 p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
        {label}
      </div>

      <div className="text-lg font-bold text-slate-900 mt-1">
        {value}
      </div>
    </div>
  );
}

// =============================================================================
// NUMBER FORMAT
// =============================================================================

function formatNumber(
  value: number,
) {
  return new Intl.NumberFormat(
    "en-EG",
    {
      maximumFractionDigits: 2,
    },
  ).format(value);
}