"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type OwnedMeetingPackage = {
  id: number;
  packageNameSnapshot?: string;
  packageName?: string;
  remainingHours: number | string;
  status: string;
};

type MeetingPackageDefinition = {
  id: number;
  name: string;
  totalHours: number | string;
  price: number | string;
  validityDays: number | null;
  status: string;
};

type PayMethod = "cash" | "visa" | "instapay" | "balance";

function money(value: unknown, currency: string) {
  const amount = Number(value);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return `${new Intl.NumberFormat("en-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(safeAmount)} ${currency || "EGP"}`;
}

function getError(data: unknown, fallback: string) {
  if (data && typeof data === "object") {
    const error = (data as { error?: unknown; message?: unknown }).error ??
      (data as { message?: unknown }).message;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

export default function MeetingPackagePurchase({
  customerId,
  phone,
  currency,
  disabled = false,
  onPurchased,
}: {
  customerId: number | null;
  phone: string;
  currency: string;
  disabled?: boolean;
  onPurchased: (purchaseId: number, packages: OwnedMeetingPackage[]) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [saving, setSaving] = useState(false);
  const [catalog, setCatalog] = useState<MeetingPackageDefinition[]>([]);
  const [packageId, setPackageId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PayMethod>("cash");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function openPanel() {
    if (!customerId || disabled || saving) return;
    setOpen((current) => !current);
    setError(null);
    setSuccess(null);
    if (catalog.length) return;

    setLoadingPackages(true);
    try {
      const res = await fetch("/api/meeting-rooms/packages", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(getError(data, "Couldn't load meeting packages."));
      const active = (data.packages ?? []).filter(
        (pkg: MeetingPackageDefinition) => pkg.status === "active",
      );
      setCatalog(active);
      if (active.length) setPackageId(String(active[0].id));
      if (!active.length) setError("No active meeting packages are available for sale.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load meeting packages.");
    } finally {
      setLoadingPackages(false);
    }
  }

  async function sellPackage() {
    if (!customerId || !packageId || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch("/api/meeting-rooms/packages/customer", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          customerId,
          packageId: Number(packageId),
          paymentMethod,
          purchasedAt: new Date().toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.purchase?.id) {
        throw new Error(getError(data, "Couldn't sell the meeting package."));
      }

      let owned: OwnedMeetingPackage[] = [];
      const packagesRes = await fetch(
        `/api/meeting-rooms/packages/customer?phone=${encodeURIComponent(phone.trim())}`,
        { cache: "no-store" },
      );
      const packagesData = await packagesRes.json().catch(() => ({}));
      if (packagesRes.ok) {
        owned = (packagesData.packages ?? []).filter(
          (pkg: OwnedMeetingPackage) => pkg.status === "active" && Number(pkg.remainingHours) > 0,
        );
      }
      const purchaseId = Number(data.purchase.id);
      onPurchased(purchaseId, owned);
      const chosen = catalog.find((pkg) => pkg.id === Number(packageId));
      setSuccess(`${chosen?.name ?? "Meeting package"} sold successfully. It is now selected for this booking.`);
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't sell the meeting package.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn btn-ghost w-full justify-center !border-indigo-200 !text-indigo-700 hover:!bg-indigo-50"
        disabled={disabled || !customerId || !phone.trim() || saving}
        onClick={openPanel}
      >
        {open ? "− Hide package sale" : "+ Sell meeting package to customer"}
      </button>
      {!customerId && (
        <p className="text-xs text-slate-500">Search for an existing customer first to sell a package to their account.</p>
      )}
      {success && <p role="status" className="text-xs font-medium text-emerald-700">{success}</p>}
      {open && (
        <div className="meeting-package-purchase-panel rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 p-4 space-y-3">
          <div>
            <p className="font-semibold text-slate-900">New meeting package</p>
            <p className="mt-0.5 text-xs text-slate-500">The sale will be recorded in this shift's revenue and cash reconciliation.</p>
          </div>
          {loadingPackages ? (
            <p className="text-sm text-slate-500">Loading available packages…</p>
          ) : (
            <>
              <div>
                <label className="label" htmlFor="meeting-package-to-sell">Package</label>
                <select
                  id="meeting-package-to-sell"
                  className="select w-full"
                  value={packageId}
                  disabled={saving || catalog.length === 0}
                  onChange={(e) => setPackageId(e.target.value)}
                >
                  {catalog.length === 0 && <option value="">No active packages</option>}
                  {catalog.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.name} · {Number(pkg.totalHours)}h · {money(pkg.price, currency)}
                    </option>
                  ))}
                </select>
              </div>
              {packageId && (() => {
                const selected = catalog.find((pkg) => pkg.id === Number(packageId));
                return selected ? (
                  <div className="rounded-xl border border-white bg-white/80 p-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-800">{selected.name}</div>
                      <div className="text-xs text-slate-500">{Number(selected.totalHours)} package hours{selected.validityDays ? ` · valid ${selected.validityDays} days` : " · no expiry"}</div>
                    </div>
                    <div className="font-bold text-indigo-700 tabular-nums">{money(selected.price, currency)}</div>
                  </div>
                ) : null;
              })()}
              <div>
                <label className="label" htmlFor="meeting-package-payment">Payment method</label>
                <select
                  id="meeting-package-payment"
                  className="select w-full"
                  value={paymentMethod}
                  disabled={saving}
                  onChange={(e) => setPaymentMethod(e.target.value as PayMethod)}
                >
                  <option value="cash">Cash</option>
                  <option value="visa">Visa</option>
                  <option value="instapay">InstaPay</option>
                  <option value="balance">Customer balance</option>
                </select>
              </div>
              <button
                type="button"
                className="btn btn-primary w-full justify-center"
                onClick={sellPackage}
                disabled={saving || loadingPackages || !packageId || catalog.length === 0}
              >
                {saving ? "Selling package…" : "Confirm package sale"}
              </button>
            </>
          )}
          {error && <p role="alert" className="text-sm font-medium text-rose-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
