"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useFmt } from "@/lib/lang-context";

type Subscription = {
  id: number;
  packageId: number;
  packageName: string;
  totalHours: number;
  price: number;
  validityDays: number | null;
  purchasedAt: string;
  startsAt: string;
  expiresAt: string | null;
  status: string;
  remainingHours: number;
};

type Package = {
  id: number;
  name: string;
  totalHours: number;
  price: number;
  validityDays: number | null;
  description: string | null;
  active: boolean;
};

type Props = {
  customerId?: number;
  showNewCustomer?: boolean;
};

export default function CustomerSubscriptionButton({
  customerId,
  showNewCustomer = true,
}: Props) {
  const f = useFmt();
  const tx = f.t;
  const [subscription, setSubscription] = useState<Subscription | null>(null);

  const [packages, setPackages] = useState<Package[]>([]);

  const [open, setOpen] = useState(false);

  const [newCustomerOpen, setNewCustomerOpen] = useState(false);

  const [loading, setLoading] = useState(Boolean(customerId));

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [success, setSuccess] = useState<string | null>(null);

  const [newCustomerName, setNewCustomerName] = useState("");

  const [newCustomerPhone, setNewCustomerPhone] = useState("");

  const [newCustomerEmail, setNewCustomerEmail] = useState("");

  const [selectedPackageId, setSelectedPackageId] = useState<number | null>(
    null,
  );

  useEffect(() => {
    void loadData();
  }, [customerId]);

  async function loadData() {
    setError(null);

    try {
      const packagesRes = await fetch("/api/subscription-packages", {
        cache: "no-store",
      });

      const packagesData = await packagesRes.json().catch(() => null);

      if (!packagesRes.ok) {
        throw new Error(packagesData?.error || tx("Could not load packages."));
      }

      setPackages(
        (packagesData?.packages ?? []).filter((pkg: Package) => pkg.active),
      );

      if (customerId) {
        setLoading(true);

        const subscriptionRes = await fetch(
          `/api/customers/${customerId}/subscription`,
          {
            cache: "no-store",
          },
        );

        const subscriptionData = await subscriptionRes
          .json()
          .catch(() => null);

        if (!subscriptionRes.ok) {
          throw new Error(
            subscriptionData?.error || tx("Could not load customer subscription."),
          );
        }

        setSubscription(subscriptionData?.subscription ?? null);
      }
    } catch (err) {
      console.error("Load subscription data error:", err);

      setError(
        err instanceof Error ? err.message : tx("Could not load subscription."),
      );
    } finally {
      setLoading(false);
    }
  }

  async function purchasePackage(packageId: number) {
    if (!customerId || saving) {
      return;
    }

    const pkg = packages.find((item) => item.id === packageId);

    if (!pkg) {
      setError(tx("Package not found."));
      return;
    }

    const confirmed = window.confirm(
      (f.en ? `Purchase "${pkg.name}" for this customer?\n\nHours: ${pkg.totalHours}\nPrice: ${pkg.price.toFixed(2)}` : `شراء "${pkg.name}" للعميل ده؟\n\nالساعات: ${pkg.totalHours}\nالسعر: ${pkg.price.toFixed(2)}`),
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch(`/api/customers/${customerId}/subscription`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          packageId,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || tx("Could not purchase package."));
      }

      setSubscription(data?.subscription ?? null);

      setSuccess(f.en ? tx("Package purchased successfully.") : "تم شراء الباقة بنجاح.");

      setOpen(false);

      await loadData();
    } catch (err) {
      console.error("Purchase package error:", err);

      setError(
        err instanceof Error ? err.message : tx("Could not purchase package."),
      );
    } finally {
      setSaving(false);
    }
  }

  function resetNewCustomerForm() {
    setNewCustomerName("");
    setNewCustomerPhone("");
    setNewCustomerEmail("");
    setSelectedPackageId(null);
    setError(null);
    setSuccess(null);
  }

  async function registerNewCustomer() {
    if (saving) {
      return;
    }

    setError(null);
    setSuccess(null);

    const name = newCustomerName.trim();

    const phone = newCustomerPhone.trim();

    const email = newCustomerEmail.trim();

    if (!name) {
      setError(tx("Customer name is required."));
      return;
    }

    if (!phone) {
      setError(tx("Customer phone is required."));
      return;
    }

    if (!selectedPackageId) {
      setError(tx("Please select a package."));
      return;
    }

    const selectedPackage = packages.find(
      (pkg) => pkg.id === selectedPackageId,
    );

    if (!selectedPackage) {
      setError(tx("Selected package not found."));
      return;
    }

    const confirmed = window.confirm(
      (f.en ? `Register "${name}" and purchase "${selectedPackage.name}"?\n\nHours: ${selectedPackage.totalHours}\nPrice: ${selectedPackage.price.toFixed(2)}` : `تسجيل "${name}" وشراء "${selectedPackage.name}"؟\n\nالساعات: ${selectedPackage.totalHours}\nالسعر: ${selectedPackage.price.toFixed(2)}`),
    );

    if (!confirmed) {
      return;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/customers/register-with-subscription", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          phone,
          email: email || null,
          packageId: selectedPackageId,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        throw new Error(data?.error || tx("Could not register customer."));
      }

      setSuccess(
        (f.en ? `Customer "${data?.customer?.name ?? name}" registered and package purchased successfully.` : `تم تسجيل العميل "${data?.customer?.name ?? name}" وشراء الباقة بنجاح.`),
      );

      resetNewCustomerForm();

      setNewCustomerOpen(false);

      // Refresh the customers page so the new customer
      // appears in the table.
      window.location.reload();
    } catch (err) {
      console.error("Register new customer error:", err);

      setError(
        err instanceof Error ? err.message : tx("Could not register customer."),
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="mt-3 text-xs text-slate-400">
        {tx("Loading subscription…")}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* EXISTING CUSTOMER */}
      {customerId && (
        <>
          {subscription ? (
            <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs uppercase tracking-wide text-indigo-500 font-semibold">
                    {tx("Active Package")}
                  </div>

                  <div className="font-bold text-indigo-900 mt-1">
                    {subscription.packageName}
                  </div>
                </div>

                <span className="px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold uppercase">
                  Active
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-3">
                <div className="rounded-lg bg-white border border-indigo-100 p-2">
                  <div className="text-[10px] text-slate-400 uppercase">
                    {tx("Remaining")}
                  </div>

                  <div className="font-bold text-slate-900">
                    {subscription.remainingHours.toFixed(2)} h
                  </div>
                </div>

                <div className="rounded-lg bg-white border border-indigo-100 p-2">
                  <div className="text-[10px] text-slate-400 uppercase">
                    {tx("Expires")}
                  </div>

                  <div className="font-bold text-slate-900">
                    {subscription.expiresAt
                      ? new Date(subscription.expiresAt).toLocaleDateString(
                          "en-EG",
                        )
                      : tx("No expiry")}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setError(null);
                setSuccess(null);
                setOpen(true);
              }}
              className="btn btn-primary w-full"
            >
              {tx("📦 Purchase Package")}
            </button>
          )}
        </>
      )}

      {/* NEW CUSTOMER BUTTON */}
      {showNewCustomer && (
        <button
          type="button"
          onClick={() => {
            resetNewCustomerForm();
            setNewCustomerOpen(true);
          }}
          className={`btn ${
            customerId ? "btn-ghost w-full" : "btn-primary w-full"
          }`}
        >
          {tx("➕ New Customer + Package")}
        </button>
      )}

      {/* SUCCESS */}
      {success && (
        <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">
          {success}
        </div>
      )}

      {/* ERROR */}
      {error && (
        <div className="p-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
          {error}
        </div>
      )}

      {/* EXISTING CUSTOMER PACKAGE MODAL */}
      {open &&
        customerId &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-indigo-600 font-semibold">
                    {tx("Customer Package")}
                  </div>

                  <h3 className="text-xl font-bold text-slate-900 mt-1">
                    {tx("Choose a package")}
                  </h3>
                </div>

                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={saving}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100"
                >
                  ✕
                </button>
              </div>

              {packages.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">
                  {tx("No active packages available.")}
                </div>
              ) : (
                <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                  {packages.map((pkg) => (
                    <button
                      key={pkg.id}
                      type="button"
                      onClick={() => void purchasePackage(pkg.id)}
                      disabled={saving}
                      className="w-full text-left rounded-xl border border-slate-200 p-4 hover:border-indigo-400 hover:bg-indigo-50 transition disabled:opacity-50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900">
                            {pkg.name}
                          </div>

                          {pkg.description && (
                            <div className="text-xs text-slate-500 mt-1">
                              {pkg.description}
                            </div>
                          )}
                        </div>

                        <div className="text-lg font-bold text-indigo-600 shrink-0">
                          {pkg.price.toFixed(2)}
                        </div>
                      </div>

                      <div className="flex gap-2 mt-3 text-xs flex-wrap">
                        <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold">
                          ⏱ {pkg.totalHours} {tx("hours")}
                        </span>

                        <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold">
                          {pkg.validityDays
                            ? `📅 ${pkg.validityDays} ${tx("days")}`
                            : tx("∞ No expiry")}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {saving && (
                <div className="text-center text-sm text-slate-500 mt-4">
                  {tx("Processing purchase…")}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}

      {/* NEW CUSTOMER MODAL */}
      {newCustomerOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
              <div className="flex items-start justify-between gap-3 mb-5">
                <div>
                  <div className="text-xs uppercase tracking-wide text-indigo-600 font-semibold">
                    {tx("New Customer")}
                  </div>

                  <h3 className="text-2xl font-bold text-slate-900 mt-1">
                    {tx("Register + Purchase Package")}
                  </h3>

                  <p className="text-sm text-slate-500 mt-1">
                    {tx("Create the customer and activate their package in one operation.")}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (!saving) {
                      setNewCustomerOpen(false);
                      resetNewCustomerForm();
                    }
                  }}
                  disabled={saving}
                  className="w-8 h-8 rounded-lg hover:bg-slate-100"
                >
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                {/* NAME */}
                <div>
                  <label className="label">{tx("Customer name")}</label>

                  <input
                    className="input"
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder={tx("Ahmed Mohamed")}
                    disabled={saving}
                    autoFocus
                  />
                </div>

                {/* PHONE */}
                <div>
                  <label className="label">{tx("Phone number")}</label>

                  <input
                    className="input"
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    placeholder="01012345678"
                    inputMode="tel"
                    disabled={saving}
                  />
                </div>

                {/* EMAIL */}
                <div>
                  <label className="label">
                    Email{" "}
                    <span className="text-slate-400 font-normal">
                      {tx("(optional)")}
                    </span>
                  </label>

                  <input
                    className="input"
                    type="email"
                    value={newCustomerEmail}
                    onChange={(e) => setNewCustomerEmail(e.target.value)}
                    placeholder="customer@email.com"
                    disabled={saving}
                  />
                </div>

                {/* PACKAGES */}
                <div>
                  <label className="label">{tx("Choose package")}</label>

                  {packages.length === 0 ? (
                    <div className="rounded-xl border border-slate-200 p-4 text-sm text-slate-500">
                      {tx("No active packages available.")}
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {packages.map((pkg) => {
                        const selected = selectedPackageId === pkg.id;

                        return (
                          <button
                            key={pkg.id}
                            type="button"
                            onClick={() => setSelectedPackageId(pkg.id)}
                            disabled={saving}
                            className={`w-full text-left rounded-xl border p-4 transition ${
                              selected
                                ? "border-indigo-500 bg-indigo-50 ring-2 ring-indigo-100"
                                : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50"
                            } disabled:opacity-50`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-bold text-slate-900">
                                  {pkg.name}
                                </div>

                                {pkg.description && (
                                  <div className="text-xs text-slate-500 mt-1">
                                    {pkg.description}
                                  </div>
                                )}
                              </div>

                              {selected && (
                                <div className="text-indigo-600 font-bold">
                                  ✓
                                </div>
                              )}
                            </div>

                            <div className="flex gap-2 mt-3 flex-wrap text-xs">
                              <span className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 font-semibold">
                                ⏱ {pkg.totalHours} {tx("hours")}
                              </span>

                              <span className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-slate-700 font-semibold">
                                {pkg.validityDays
                                  ? `📅 ${pkg.validityDays} ${tx("days")}`
                                  : tx("∞ No expiry")}
                              </span>

                              <span className="px-2 py-1 rounded-lg bg-white border border-slate-200 text-indigo-700 font-bold">
                                💰 {pkg.price.toFixed(2)}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* SELECTED PACKAGE SUMMARY */}
                {selectedPackageId && (
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-4">
                    {(() => {
                      const pkg = packages.find(
                        (item) => item.id === selectedPackageId,
                      );

                      if (!pkg) {
                        return null;
                      }

                      return (
                        <>
                          <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold">
                            {tx("Purchase summary")}
                          </div>

                          <div className="flex items-center justify-between mt-2">
                            <span className="font-semibold text-slate-700">
                              {pkg.name}
                            </span>

                            <span className="font-bold text-indigo-600">
                              {pkg.price.toFixed(2)}
                            </span>
                          </div>

                          <div className="text-sm text-slate-500 mt-1">
                            {pkg.totalHours} {tx("hours")}
                            {" · "}
                            {pkg.validityDays
                              ? `${pkg.validityDays} ${tx("days validity")}`
                              : tx("No expiry")}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                )}

                {/* ERROR INSIDE MODAL */}
                {error && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">
                    {error}
                  </div>
                )}

                {/* ACTIONS */}
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setNewCustomerOpen(false);
                      resetNewCustomerForm();
                    }}
                    disabled={saving}
                    className="btn btn-ghost flex-1"
                  >
                    {tx("Cancel")}
                  </button>

                  <button
                    type="button"
                    onClick={() => void registerNewCustomer()}
                    disabled={
                      saving ||
                      !newCustomerName.trim() ||
                      !newCustomerPhone.trim() ||
                      !selectedPackageId
                    }
                    className="btn btn-primary flex-1"
                  >
                    {saving ? tx("Processing…") : tx("Create + Purchase")}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}