"use client";

import { useEffect, useState } from "react";
import { useFmt } from "@/lib/lang-context";
import { PageBar, Panel, StatStrip } from "../_components/ui";

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
  const f = useFmt();
  const tx = f.t;
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
            tx("Could not load packages."),
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
          : tx("Could not load packages."),
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
            tx("Could not save package."),
        );
      }

      setSuccess(
        editingId === null
          ? tx("Package created successfully.")
          : tx("Package updated successfully."),
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
          : tx("Could not save package."),
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
            tx("Could not change package status."),
        );
      }

      setSuccess(
        pkg.active
          ? tx("Package deactivated.")
          : tx("Package activated."),
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
          : tx("Could not change package status."),
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
          ? (f.en ? `Deactivate "${pkg.name}"?` : `إيقاف "${pkg.name}"؟`)
          : (f.en ? `Remove "${pkg.name}" if it has never been sold?` : `حذف "${pkg.name}" لو عمرها ما اتباعت؟`),
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
            tx("Could not remove package."),
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
          tx("Package archived because it has historical purchases. Its history is preserved."),
        );
      } else {
        setPackages((current) =>
          current.filter((item) => item.id !== pkg.id),
        );

        setSuccess(tx("Package deleted."));
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
          : tx("Could not remove package."),
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

  const activeCount = packages.length - inactiveCount;
  const avgPerHour = (() => {
    const act = packages.filter((p) => p.active && p.totalHours > 0);
    return act.length ? act.reduce((s, p) => s + p.price / p.totalHours, 0) / act.length : 0;
  })();

  return (
    <div>
      <PageBar
        crumb={tx("Subscriptions")}
        title={tx("Subscription Packages")}
        description={tx("Create and manage the packages customers can purchase.")}
      />

      <StatStrip
        items={[
          { label: tx("packages"), value: String(packages.length), tone: "brand" },
          { label: tx("Active"), value: String(activeCount), tone: "green" },
          { label: tx("Inactive"), value: String(inactiveCount), tone: "slate" },
          { label: f.en ? "Avg. price per hour" : "متوسط سعر الساعة", value: formatNumber(avgPerHour), tone: "amber" },
        ]}
      />

      {error && <div className="v2-alert red" style={{ marginTop: 16 }}>{error}</div>}
      {success && <div className="v2-alert green" style={{ marginTop: 16 }}>{success}</div>}

      <div className="v2-split rev" style={{ marginTop: 20 }}>
        <aside className="v2-sticky">
          <Panel title={editingId === null ? tx("Create package") : tx("Edit package")}>
            <form onSubmit={savePackage} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label className="label">{tx("Package name")}</label>
                <input className="input" value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder={tx("e.g. 60 Hours")} disabled={saving} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label className="label">{tx("Total hours")}</label>
                  <input className="input" type="number" min="0.01" step="0.01" value={form.totalHours} onChange={(e) => updateField("totalHours", e.target.value)} placeholder="60" disabled={saving} />
                </div>
                <div>
                  <label className="label">{tx("Price")}</label>
                  <input className="input" type="number" min="0" step="0.01" value={form.price} onChange={(e) => updateField("price", e.target.value)} placeholder="1500" disabled={saving} />
                </div>
              </div>
              <div>
                <label className="label">{tx("Validity")}</label>
                <input className="input" type="number" min="1" step="1" value={form.validityDays} onChange={(e) => updateField("validityDays", e.target.value)} placeholder="30" disabled={saving} />
                <p className="text-xs text-slate-400 mt-1">{tx("Leave empty for no expiry.")}</p>
              </div>
              <div>
                <label className="label">{tx("Description")}</label>
                <textarea className="input min-h-24 resize-y" value={form.description} onChange={(e) => updateField("description", e.target.value)} placeholder={tx("Optional package details...")} disabled={saving} />
              </div>
              <label htmlFor="package-active" style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13.5, fontWeight: 600 }}>
                <input id="package-active" type="checkbox" checked={form.active} onChange={(e) => updateField("active", e.target.checked)} disabled={saving} className="w-4 h-4" />
                {tx("Available for new purchases")}
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? tx("Saving…") : editingId === null ? tx("Create package") : tx("Save changes")}
                </button>
                {editingId !== null && (
                  <button type="button" onClick={resetForm} className="btn btn-ghost" disabled={saving}>{tx("Cancel")}</button>
                )}
              </div>
              <p className="text-xs text-slate-400">{tx("The values entered here become the package definition for future purchases.")}</p>
            </form>
          </Panel>
        </aside>

        <div style={{ minWidth: 0 }}>
          <div className="v2-toolbar" style={{ marginBottom: 14 }}>
            <span className="text-sm text-slate-500">
              {showInactive ? tx("Showing active and inactive packages.") : tx("Showing active packages only.")}
            </span>
            {inactiveCount > 0 && (
              <button type="button" className="btn btn-ghost" onClick={() => setShowInactive((c) => !c)} disabled={saving}>
                {showInactive ? tx("Hide inactive packages") : (f.en ? `Show inactive packages (${inactiveCount})` : `عرض الباقات غير النشطة (${inactiveCount})`)}
              </button>
            )}
          </div>

          {loading ? (
            <div className="v2-empty">{tx("Loading packages…")}</div>
          ) : visiblePackages.length === 0 ? (
            <div className="v2-empty">
              <div style={{ fontSize: 40 }}>📦</div>
              <b>{tx("No packages yet")}</b>
              <div>{tx("Create your first subscription package above.")}</div>
            </div>
          ) : (
            <div className="v2-pkgs">
              {visiblePackages.map((pkg) => (
                <div key={pkg.id} className={`v2-pkg${pkg.active ? "" : " off"}${editingId === pkg.id ? " sel" : ""}`}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                    <h3>{pkg.name}</h3>
                    <span className={`v2-tag ${pkg.active ? "green" : "slate"}`}>{pkg.active ? tx("Active") : tx("Inactive")}</span>
                  </div>
                  <div className="v2-pkg-price">{formatNumber(pkg.price)}<small>{f.cur}</small></div>
                  <ul>
                    <li><span>{tx("Hours")}</span><b>{formatNumber(pkg.totalHours)} {f.en ? "h" : "س"}</b></li>
                    <li><span>{tx("Validity")}</span><b>{pkg.validityDays === null ? tx("No expiry") : `${pkg.validityDays} ${tx("days")}`}</b></li>
                    {pkg.totalHours > 0 && <li><span>{f.en ? "Per hour" : "سعر الساعة"}</span><b>{formatNumber(pkg.price / pkg.totalHours)}</b></li>}
                  </ul>
                  {pkg.description && <p>{pkg.description}</p>}
                  <div className="v2-pkg-actions">
                    <button type="button" onClick={() => editPackage(pkg)} className="btn btn-ghost" disabled={saving}>{tx("Edit")}</button>
                    <button type="button" onClick={() => void toggleActive(pkg)} className="btn btn-ghost" disabled={saving}>{pkg.active ? tx("Deactivate") : tx("Activate")}</button>
                    <button type="button" onClick={() => void deletePackage(pkg)} className="btn btn-ghost text-red-600" disabled={saving}>{tx("Delete")}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-400" style={{ marginTop: 14 }}>
            {tx("Changing these values affects future purchases only. Historical customer subscriptions keep their original price and hours.")}
          </p>
        </div>
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