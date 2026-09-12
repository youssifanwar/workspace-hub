"use client";

import {
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";

type CustomerSubscription = {
  id: number;
  packageName: string;
  totalHours: string;
  usedHours: string;
  remainingHours: string;
  price: string;
  startsAt: string;
  expiresAt: string | null;
  status: "active" | "expired" | "exhausted" | "cancelled";
};

type CustomerLookupResult = {
  found: boolean;
  customer?: {
    id: number;
    name: string;
    phone: string;
    email: string | null;
    notes: string | null;
    createdAt: string;
  };
  stats?: {
    visits: number;
    totalHours: number;
    totalSpent: number;
  };
  subscriptions?: CustomerSubscription[];
};

type CreatedSession = {
  bookingId: number;
  accessCode: string;
  customerName: string;
  billingMode: "regular" | "package";
  subscriptionId: number | null;
};

export default function CheckInModal({
  currency,
  onClose,
}: {
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();

  // ---------------------------------------------------------------------------
  // FORM
  // ---------------------------------------------------------------------------

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  // ---------------------------------------------------------------------------
  // CUSTOMER LOOKUP
  // ---------------------------------------------------------------------------

  const [lookupLoading, setLookupLoading] =
    useState(false);

  const [lookupError, setLookupError] =
    useState<string | null>(null);

  const [existingCustomer, setExistingCustomer] =
    useState<
      CustomerLookupResult["customer"] | null
    >(null);

  const [customerStats, setCustomerStats] =
    useState<
      CustomerLookupResult["stats"] | null
    >(null);

  const [subscriptions, setSubscriptions] =
    useState<CustomerSubscription[]>([]);

  // ---------------------------------------------------------------------------
  // BILLING
  // ---------------------------------------------------------------------------

  const [billingMode, setBillingMode] =
    useState<"regular" | "package">(
      "regular",
    );

  const [selectedSubscriptionId, setSelectedSubscriptionId] =
    useState<number | null>(null);

  // ---------------------------------------------------------------------------
  // REQUEST
  // ---------------------------------------------------------------------------

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // SUCCESS
  // ---------------------------------------------------------------------------

  const [createdSession, setCreatedSession] =
    useState<CreatedSession | null>(null);

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  function cleanPhone(value: string) {
    return value
      .replace(/[^\d+]/g, "")
      .trim();
  }

  const normalizedInputPhone =
    cleanPhone(phone);

  const activeSubscriptions =
    subscriptions.filter(
      (subscription) =>
        subscription.status === "active" &&
        (
          subscription.expiresAt === null ||
          new Date(
            subscription.expiresAt,
          ).getTime() > Date.now()
        ) &&
        parseFloat(
          subscription.remainingHours || "0",
        ) > 0,
    );

  // ---------------------------------------------------------------------------
  // CUSTOMER LOOKUP
  // ---------------------------------------------------------------------------

  async function lookupCustomer(
    suppliedPhone?: string,
  ) {
    const value =
      cleanPhone(
        suppliedPhone ?? phone,
      );

    setLookupError(null);

    if (!value) {
      setExistingCustomer(null);
      setCustomerStats(null);
      setSubscriptions([]);
      setSelectedSubscriptionId(null);
      setBillingMode("regular");
      return;
    }

    // Don't attempt lookup for extremely short values.
    const digitsOnly = value.replace(
      /\D/g,
      "",
    );

    if (digitsOnly.length < 8) {
      return;
    }

    setLookupLoading(true);

    try {
      const res = await fetch(
        `/api/customers/lookup?phone=${encodeURIComponent(
          value,
        )}`,
        {
          method: "GET",
          cache: "no-store",
        },
      );

      const data =
        (await res.json().catch(
          () => null,
        )) as CustomerLookupResult | {
          error?: string;
        } | null;

      if (!res.ok) {
        setLookupError(
          data &&
          "error" in data &&
          data.error
            ? data.error
            : "Could not search for the customer.",
        );

        setExistingCustomer(null);
        setCustomerStats(null);
        setSubscriptions([]);
        setSelectedSubscriptionId(null);
        setBillingMode("regular");
        return;
      }

      const result =
        data as CustomerLookupResult;

      if (!result.found || !result.customer) {
        setExistingCustomer(null);
        setCustomerStats(null);
        setSubscriptions([]);
        setSelectedSubscriptionId(null);
        setBillingMode("regular");
        return;
      }

      // Existing customer found.
      setExistingCustomer(
        result.customer,
      );

      setName(
        result.customer.name,
      );

      setPhone(
        result.customer.phone,
      );

      setCustomerStats(
        result.stats ?? null,
      );

      const foundSubscriptions =
        result.subscriptions ?? [];

      setSubscriptions(
        foundSubscriptions,
      );

      // -----------------------------------------------------------------------
      // AUTO PACKAGE SELECTION
      //
      // If the customer has exactly ONE active package with available hours,
      // select it automatically and switch billing to Package.
      //
      // If there are multiple available packages, keep Regular until the
      // employee explicitly chooses which package to use.
      // -----------------------------------------------------------------------

      const availableSubscriptions =
        foundSubscriptions.filter(
          (subscription) =>
            subscription.status ===
              "active" &&
            (
              subscription.expiresAt ===
                null ||
              new Date(
                subscription.expiresAt,
              ).getTime() > Date.now()
            ) &&
            parseFloat(
              subscription.remainingHours ||
                "0",
            ) > 0,
        );

      if (
        availableSubscriptions.length ===
        1
      ) {
        setBillingMode("package");

        setSelectedSubscriptionId(
          availableSubscriptions[0].id,
        );
      } else {
        setBillingMode("regular");
        setSelectedSubscriptionId(null);
      }
    } catch (err) {
      console.error(
        "Customer lookup failed:",
        err,
      );

      setLookupError(
        "Could not connect to the server while searching for the customer.",
      );

      setExistingCustomer(null);
      setCustomerStats(null);
      setSubscriptions([]);
      setSelectedSubscriptionId(null);
      setBillingMode("regular");
    } finally {
      setLookupLoading(false);
    }
  }

  // Lookup after the user finishes typing/pasting the phone.
  useEffect(() => {
    if (!normalizedInputPhone) {
      setExistingCustomer(null);
      setCustomerStats(null);
      setSubscriptions([]);
      setSelectedSubscriptionId(null);
      setBillingMode("regular");
      return;
    }

    const timer = window.setTimeout(() => {
      void lookupCustomer(
        normalizedInputPhone,
      );
    }, 450);

    return () => {
      window.clearTimeout(timer);
    };
  }, [normalizedInputPhone]);

  // ---------------------------------------------------------------------------
  // SELECT PACKAGE
  // ---------------------------------------------------------------------------

  function selectBillingMode(
    mode: "regular" | "package",
  ) {
    setBillingMode(mode);

    if (mode === "regular") {
      setSelectedSubscriptionId(null);
      return;
    }

    if (
      selectedSubscriptionId === null &&
      activeSubscriptions.length === 1
    ) {
      setSelectedSubscriptionId(
        activeSubscriptions[0].id,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // VALIDATION
  // ---------------------------------------------------------------------------

  function validateForm() {
    const customerName =
      name.trim();

    const customerPhone =
      cleanPhone(phone);

    if (!customerName) {
      return "Enter the customer name.";
    }

    if (!customerPhone) {
      return "Enter the customer phone number.";
    }

    if (
      customerPhone.replace(
        /\D/g,
        "",
      ).length < 8
    ) {
      return "Enter a valid customer phone number.";
    }

    if (
      billingMode === "package"
    ) {
      if (!existingCustomer) {
        return "A customer must already exist before using a package.";
      }

      if (
        activeSubscriptions.length ===
        0
      ) {
        return "This customer has no active package with available hours.";
      }

      if (
        selectedSubscriptionId ===
        null
      ) {
        return "Select the package to use for this session.";
      }

      const selected =
        activeSubscriptions.find(
          (subscription) =>
            subscription.id ===
            selectedSubscriptionId,
        );

      if (!selected) {
        return "The selected package is no longer available.";
      }

      if (
        parseFloat(
          selected.remainingHours,
        ) <= 0
      ) {
        return "The selected package has no remaining hours.";
      }
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // START SESSION
  // ---------------------------------------------------------------------------

  async function submit(
    e: React.FormEvent,
  ) {
    e.preventDefault();

    if (loading) {
      return;
    }

    setError(null);

    const validationError =
      validateForm();

    if (validationError) {
      setError(
        validationError,
      );
      return;
    }

    setLoading(true);

    try {
      const customerName =
        name.trim();

      const customerPhone =
        cleanPhone(phone);

      const res = await fetch(
        "/api/bookings",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            customerName,
            customerPhone,

            // Existing customer -> reuse it.
            customerId:
              existingCustomer?.id ??
              undefined,

            // Regular or package billing.
            billingMode,

            // Only supplied for package billing.
            subscriptionId:
              billingMode ===
              "package"
                ? selectedSubscriptionId
                : null,
          }),
        },
      );

      const data =
        await res.json().catch(
          () => null,
        );

      if (!res.ok) {
        setError(
          data?.error ||
            "Failed to start session.",
        );
        setLoading(false);
        return;
      }

      if (
        !data?.bookingId ||
        !data?.accessCode
      ) {
        setError(
          "Session started, but the access code was not returned.",
        );
        setLoading(false);
        return;
      }

      setCreatedSession({
        bookingId:
          Number(
            data.bookingId,
          ),

        accessCode:
          String(
            data.accessCode,
          ),

        customerName:
          String(
            data.customerName ??
              customerName,
          ),

        billingMode:
          billingMode,

        subscriptionId:
          data.subscriptionId
            ? Number(
                data.subscriptionId,
              )
            : null,
      });

      setLoading(false);
    } catch (err) {
      console.error(
        "Start session failed:",
        err,
      );

      setError(
        "Could not connect to the server. Please try again.",
      );

      setLoading(false);
    }
  }

  // ---------------------------------------------------------------------------
  // OPEN SESSION
  // ---------------------------------------------------------------------------

  function openSession() {
    if (!createdSession) {
      return;
    }

    router.push(
      `/bookings/${createdSession.bookingId}`,
    );
  }

  // ---------------------------------------------------------------------------
  // CLOSE
  // ---------------------------------------------------------------------------

  function closeModal() {
    setError(null);
    onClose();
  }

  // ===========================================================================
  // SUCCESS
  // ===========================================================================

  if (createdSession) {
    const selectedPackage =
      createdSession.subscriptionId
        ? subscriptions.find(
            (subscription) =>
              subscription.id ===
              createdSession.subscriptionId,
          )
        : null;

    return (
      <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
        <div className="card w-full max-w-md p-6">
          <div className="text-center">

            <div className="text-xs uppercase text-emerald-600 font-semibold">
              Session Started
            </div>

            <h3 className="text-2xl font-bold mt-1">
              Customer checked in
            </h3>

            <p className="text-sm text-slate-500 mt-2">
              {createdSession.customerName}
            </p>

            {/* ACCESS CODE */}

            <div className="mt-6 rounded-2xl bg-indigo-50 border border-indigo-100 p-6">
              <div className="text-sm text-indigo-700 font-semibold">
                Customer Access Code
              </div>

              <div className="text-5xl font-black tracking-[0.35em] text-indigo-900 mt-2">
                {
                  createdSession.accessCode
                }
              </div>

              <p className="text-xs text-indigo-600 mt-3">
                Give this 4-digit code
                to the customer.
              </p>
            </div>

            {/* SESSION INFO */}

            <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-600 text-left">
              <div className="font-semibold text-slate-800">
                Active customer session
              </div>

              <div className="mt-1">
                Session #
                {
                  createdSession.bookingId
                }
              </div>

              <div className="mt-2">
                Billing:
                {" "}
                <strong>
                  {createdSession.billingMode ===
                  "package"
                    ? "Package"
                    : "Regular"}
                </strong>
              </div>

              {selectedPackage && (
                <div className="mt-2">
                  Package:
                  {" "}
                  <strong>
                    {
                      selectedPackage.packageName
                    }
                  </strong>
                </div>
              )}

              <div className="mt-2">
                The customer can move between
                desks and meeting rooms without
                resetting the timer or invoice.
              </div>
            </div>

            <div className="flex gap-2 mt-6">

              <button
                type="button"
                onClick={closeModal}
                className="btn btn-ghost flex-1"
              >
                Close
              </button>

              <button
                type="button"
                onClick={openSession}
                className="btn btn-primary flex-1"
              >
                Open session →
              </button>

            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===========================================================================
  // FORM
  // ===========================================================================

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
      <div className="card w-full max-w-md p-6">

        <div className="flex items-start justify-between mb-5">

          <div>
            <div className="text-xs uppercase text-indigo-600 font-semibold">
              Start Session
            </div>

            <h3 className="text-xl font-bold">
              Customer session
            </h3>

            <p className="text-sm text-slate-500 mt-1">
              Search by phone to find an existing
              customer or create a new one.
            </p>
          </div>

          <button
            type="button"
            onClick={closeModal}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 grid place-items-center"
            aria-label="Close"
            disabled={loading}
          >
            ✕
          </button>

        </div>

        <form
          onSubmit={submit}
          className="space-y-4"
        >

          {/* PHONE */}

          <div>
            <label className="label">
              Phone number
            </label>

            <input
              className="input"
              value={phone}
              onChange={(e) => {
                setPhone(
                  e.target.value,
                );

                // Clear stale customer while typing a different number.
                if (
                  existingCustomer &&
                  cleanPhone(
                    e.target.value,
                  ) !==
                    cleanPhone(
                      existingCustomer.phone,
                    )
                ) {
                  setExistingCustomer(
                    null,
                  );

                  setCustomerStats(
                    null,
                  );

                  setSubscriptions(
                    [],
                  );

                  setSelectedSubscriptionId(
                    null,
                  );

                  setBillingMode(
                    "regular",
                  );
                }
              }}
              onBlur={() =>
                void lookupCustomer()
              }
              placeholder="e.g. 0100 000 0000"
              required
              autoFocus
              disabled={loading}
            />

            {lookupLoading && (
              <p className="text-xs text-indigo-600 mt-1">
                Searching customer…
              </p>
            )}

            {lookupError && (
              <div className="mt-2 p-2.5 rounded-xl bg-red-50 border border-red-100 text-xs text-red-700">
                {lookupError}
              </div>
            )}
          </div>

          {/* EXISTING CUSTOMER */}

          {existingCustomer ? (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-4">

              <div className="flex items-start gap-3">

                <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center font-bold shrink-0">
                  {existingCustomer.name
                    .charAt(0)
                    .toUpperCase()}
                </div>

                <div className="min-w-0 flex-1">

                  <div className="text-xs uppercase text-emerald-700 font-semibold">
                    Existing customer
                  </div>

                  <div className="font-bold text-slate-900 mt-0.5">
                    {
                      existingCustomer.name
                    }
                  </div>

                  <div className="text-xs text-slate-500 mt-1">
                    📞{" "}
                    {
                      existingCustomer.phone
                    }
                  </div>

                  {customerStats && (
                    <div className="grid grid-cols-3 gap-2 mt-3">

                      <Stat
                        label="Visits"
                        value={String(
                          customerStats.visits,
                        )}
                      />

                      <Stat
                        label="Hours"
                        value={customerStats.totalHours.toFixed(
                          2,
                        )}
                      />

                      <Stat
                        label="Spent"
                        value={`${customerStats.totalSpent.toFixed(
                          2,
                        )} ${currency}`}
                      />

                    </div>
                  )}

                </div>
              </div>

            </div>
          ) : (
            /* NEW CUSTOMER NAME */
            <div>
              <label className="label">
                Customer name
              </label>

              <input
                className="input"
                value={name}
                onChange={(e) =>
                  setName(
                    e.target.value,
                  )
                }
                placeholder="e.g. Ahmed Ali"
                required
                disabled={
                  loading ||
                  !!existingCustomer
                }
              />

              <p className="text-xs text-slate-400 mt-1">
                New customer — this information
                will be saved permanently.
              </p>
            </div>
          )}

          {/* NAME FOR EXISTING CUSTOMER */}

          {existingCustomer && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <div className="text-xs text-slate-500">
                Customer name
              </div>

              <div className="font-semibold text-slate-800 mt-1">
                {
                  existingCustomer.name
                }
              </div>
            </div>
          )}

          {/* BILLING MODE */}

          <div>
            <label className="label">
              Session billing
            </label>

            <div className="grid grid-cols-2 gap-2">

              <button
                type="button"
                onClick={() =>
                  selectBillingMode(
                    "regular",
                  )
                }
                disabled={loading}
                className={`rounded-xl border p-3 text-left transition ${
                  billingMode ===
                  "regular"
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="font-bold">
                  Regular
                </div>

                <div className="text-xs mt-1 opacity-70">
                  Pay normal session price
                </div>
              </button>

              <button
                type="button"
                onClick={() =>
                  selectBillingMode(
                    "package",
                  )
                }
                disabled={
                  loading ||
                  !existingCustomer ||
                  activeSubscriptions.length ===
                    0
                }
                className={`rounded-xl border p-3 text-left transition ${
                  billingMode ===
                  "package"
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 bg-white hover:border-slate-300"
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                <div className="font-bold">
                  Package
                </div>

                <div className="text-xs mt-1 opacity-70">
                  Use customer package hours
                </div>
              </button>

            </div>

            {!existingCustomer && (
              <p className="text-xs text-slate-400 mt-1">
                Package billing is available for
                existing customers only.
              </p>
            )}

            {existingCustomer &&
              activeSubscriptions.length ===
                0 && (
                <p className="text-xs text-slate-400 mt-1">
                  This customer has no active
                  package with available hours.
                </p>
              )}
          </div>

          {/* ACTIVE PACKAGES */}

          {billingMode ===
            "package" &&
            activeSubscriptions.length >
              0 && (
              <div>
                <label className="label">
                  Select package
                </label>

                <div className="space-y-2">

                  {activeSubscriptions.map(
                    (subscription) => {
                      const remaining =
                        parseFloat(
                          subscription.remainingHours ||
                            "0",
                        );

                      const selected =
                        selectedSubscriptionId ===
                        subscription.id;

                      return (
                        <button
                          type="button"
                          key={
                            subscription.id
                          }
                          onClick={() =>
                            setSelectedSubscriptionId(
                              subscription.id,
                            )
                          }
                          disabled={loading}
                          className={`w-full rounded-2xl border p-4 text-left transition ${
                            selected
                              ? "border-indigo-500 bg-indigo-50"
                              : "border-slate-200 bg-white hover:border-indigo-300"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">

                            <div>
                              <div className="font-bold text-slate-900">
                                {
                                  subscription.packageName
                                }
                              </div>

                              <div className="text-xs text-slate-500 mt-1">
                                {
                                  subscription.totalHours
                                }{" "}
                                total hours
                              </div>
                            </div>

                            <div className="text-right shrink-0">

                              <div className="font-bold text-indigo-600">
                                {remaining.toFixed(
                                  2,
                                )}{" "}
                                hours
                              </div>

                              <div className="text-[11px] text-slate-400">
                                remaining
                              </div>

                            </div>

                          </div>

                          {subscription.expiresAt && (
                            <div className="text-xs text-slate-400 mt-2">
                              Expires{" "}
                              {formatDate(
                                subscription.expiresAt,
                              )}
                            </div>
                          )}

                        </button>
                      );
                    },
                  )}

                </div>
              </div>
            )}

          {/* ERROR */}

          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* ACTIONS */}

          <div className="flex gap-2 pt-2">

            <button
              type="button"
              onClick={closeModal}
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
                lookupLoading
              }
            >
              {loading
                ? "Starting…"
                : "Start session →"}
            </button>

          </div>

        </form>
      </div>
    </div>
  );
}

// =============================================================================
// SMALL STAT
// =============================================================================

function Stat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl bg-white/70 border border-emerald-100 p-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
        {label}
      </div>

      <div className="text-sm font-bold text-slate-800 mt-0.5 truncate">
        {value}
      </div>
    </div>
  );
}

// =============================================================================
// DATE
// =============================================================================

function formatDate(
  value: string,
) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value;
  }

  return date.toLocaleDateString(
    "en-EG",
    {
      year: "numeric",
      month: "short",
      day: "numeric",
    },
  );
}