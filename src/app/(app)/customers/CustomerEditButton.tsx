"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Customer = {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  notes: string | null;
};

type ActiveSubscription = {
  id: number;
  packageName: string;
  totalHours: number;
  remainingHours: number;
  price: number;
  validityDays: number | null;
  startsAt: string;
  expiresAt: string | null;
  status: "active" | "expired" | "exhausted" | "cancelled";
};

function money(value: number | string): string {
  const amount =
    typeof value === "number"
      ? value
      : Number(value);

  return Number.isFinite(amount)
    ? amount.toFixed(2)
    : "0.00";
}

export default function CustomerEditButton({
  customer,
  currency,
}: {
  customer: Customer;
  currency: string;
}) {
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState(customer.name);
  const [phone, setPhone] = useState(customer.phone);
  const [email, setEmail] = useState(customer.email ?? "");
  const [notes, setNotes] = useState(customer.notes ?? "");

  const [subscription, setSubscription] =
    useState<ActiveSubscription | null>(null);
  const [loadingSubscription, setLoadingSubscription] =
    useState(false);
  const [subscriptionError, setSubscriptionError] =
    useState<string | null>(null);

  const [refundAmount, setRefundAmount] =
    useState("");
  const [refundMethod, setRefundMethod] =
    useState<"cash" | "visa" | "instapay">("cash");
  const [refundReason, setRefundReason] =
    useState("Customer requested a package refund.");

  const [saving, setSaving] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setName(customer.name);
    setPhone(customer.phone);
    setEmail(customer.email ?? "");
    setNotes(customer.notes ?? "");
    setError(null);
    setSuccess(null);
    setSubscriptionError(null);
    setRefundAmount("");
    setRefundMethod("cash");
    setRefundReason("Customer requested a package refund.");

    let cancelled = false;

    async function loadSubscription() {
      setLoadingSubscription(true);
      try {
        const response = await fetch(
          `/api/customers/${customer.id}/subscription`,
          {
            method: "GET",
            cache: "no-store",
            headers: {
              Accept: "application/json",
            },
          },
        );

        const data = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            data?.error ||
              `Could not load customer package (HTTP ${response.status}).`,
          );
        }

        if (!cancelled) {
          const loaded = data?.subscription;
          if (loaded) {
            setSubscription({
              ...loaded,
              totalHours: Number(loaded.totalHours),
              remainingHours: Number(loaded.remainingHours),
              price: Number(loaded.price),
            });
            setRefundAmount(
              Number(loaded.price).toFixed(2),
            );
          } else {
            setSubscription(null);
          }
        }
      } catch (loadError) {
        if (!cancelled) {
          setSubscriptionError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load the customer package.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoadingSubscription(false);
        }
      }
    }

    void loadSubscription();

    return () => {
      cancelled = true;
    };
  }, [open, customer]);

  async function saveCustomer() {
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();

    if (!trimmedName) {
      setError("Customer name is required.");
      return;
    }

    if (!trimmedPhone) {
      setError("Customer phone is required.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(
        `/api/customers/${customer.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            name: trimmedName,
            phone: trimmedPhone,
            email: email.trim() || null,
            notes: notes.trim() || null,
          }),
        },
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.error ||
            `Could not update customer (HTTP ${response.status}).`,
        );
      }

      setSuccess("Customer information updated successfully.");
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not update customer.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function refundPackage() {
    if (!subscription) {
      return;
    }

    const amount = Number(refundAmount);

    if (!Number.isFinite(amount) || amount < 0) {
      setError("Refund amount must be a valid non-negative number.");
      return;
    }

    if (amount > subscription.price) {
      setError(
        `Refund cannot be greater than ${money(subscription.price)} ${currency}.`,
      );
      return;
    }

    const confirmed = window.confirm(
      `Refund ${money(amount)} ${currency} for ${subscription.packageName} and cancel the customer's package?`,
    );

    if (!confirmed) {
      return;
    }

    setRefunding(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(
        `/api/customers/${customer.id}/subscription`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            subscriptionId: subscription.id,
            refundAmount: amount,
            refundMethod,
            reason: refundReason.trim() || null,
          }),
        },
      );

      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(
          data?.error ||
            `Could not refund package (HTTP ${response.status}).`,
        );
      }

      setSubscription(null);
      setSuccess(
        `Package cancelled and refund recorded: ${money(data?.refundAmount ?? amount)} ${currency}.`,
      );
      router.refresh();
    } catch (refundError) {
      setError(
        refundError instanceof Error
          ? refundError.message
          : "Could not refund the package.",
      );
    } finally {
      setRefunding(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost text-indigo-600"
        onClick={() => setOpen(true)}
      >
        ✏️ Edit
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl bg-white shadow-2xl border border-slate-200">
            <div className="p-5 border-b border-slate-100 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-wide text-indigo-600 font-bold">
                  Customer
                </div>
                <h3 className="text-2xl font-black text-slate-900 mt-1">
                  Edit customer
                </h3>
                <p className="text-sm text-slate-500 mt-1">
                  Changes keep the same customer ID, so booking history stays connected.
                </p>
              </div>

              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setOpen(false)}
                disabled={saving || refunding}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field
                  label="Name"
                  value={name}
                  onChange={setName}
                />
                <Field
                  label="Phone"
                  value={phone}
                  onChange={setPhone}
                />
                <Field
                  label="Email"
                  value={email}
                  onChange={setEmail}
                  type="email"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Notes
                </label>
                <textarea
                  className="input w-full min-h-28"
                  value={notes}
                  onChange={(event) =>
                    setNotes(event.target.value)
                  }
                  disabled={saving || refunding}
                />
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <div className="font-bold text-amber-900">
                  Package & refund
                </div>

                {loadingSubscription ? (
                  <div className="text-sm text-amber-800 mt-2">
                    Loading current package...
                  </div>
                ) : subscriptionError ? (
                  <div className="text-sm text-red-700 mt-2">
                    {subscriptionError}
                  </div>
                ) : subscription ? (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <Info
                        label="Package"
                        value={subscription.packageName}
                      />
                      <Info
                        label="Price"
                        value={`${money(subscription.price)} ${currency}`}
                      />
                      <Info
                        label="Total hours"
                        value={`${subscription.totalHours} h`}
                      />
                      <Info
                        label="Remaining"
                        value={`${subscription.remainingHours} h`}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">
                          Refund amount
                        </label>
                        <input
                          className="input w-full"
                          type="number"
                          min="0"
                          max={subscription.price}
                          step="0.01"
                          value={refundAmount}
                          onChange={(event) =>
                            setRefundAmount(event.target.value)
                          }
                          disabled={refunding}
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">
                          Refund method
                        </label>
                        <select
                          className="input w-full"
                          value={refundMethod}
                          onChange={(event) =>
                            setRefundMethod(
                              event.target.value as
                                | "cash"
                                | "visa"
                                | "instapay",
                            )
                          }
                          disabled={refunding}
                        >
                          <option value="cash">Cash</option>
                          <option value="visa">Visa</option>
                          <option value="instapay">InstaPay</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">
                          Reason
                        </label>
                        <input
                          className="input w-full"
                          value={refundReason}
                          onChange={(event) =>
                            setRefundReason(event.target.value)
                          }
                          disabled={refunding}
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn bg-red-600 text-white hover:bg-red-700 w-full"
                      onClick={() => void refundPackage()}
                      disabled={refunding || saving}
                    >
                      {refunding
                        ? "Processing refund..."
                        : "↩️ Refund package & cancel"}
                    </button>

                    <div className="text-xs text-amber-800">
                      Refunding cancels this package and removes its remaining hours. Cash refunds are also recorded as a bank withdrawal for the current shift.
                    </div>
                  </div>
                ) : (
                  <div className="text-sm text-slate-600 mt-2">
                    No active package for this customer.
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {error}
                </div>
              )}

              {success && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">
                  {success}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-slate-100 flex gap-3 justify-end">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setOpen(false)}
                disabled={saving || refunding}
              >
                Close
              </button>

              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void saveCustomer()}
                disabled={saving || refunding}
              >
                {saving ? "Saving..." : "Save customer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-2">
        {label}
      </label>
      <input
        className="input w-full"
        type={type}
        value={value}
        onChange={(event) =>
          onChange(event.target.value)
        }
      />
    </div>
  );
}

function Info({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-white border border-amber-200 p-3">
      <div className="text-[11px] uppercase font-bold text-slate-500">
        {label}
      </div>
      <div className="mt-1 font-bold text-slate-800">
        {value}
      </div>
    </div>
  );
}
