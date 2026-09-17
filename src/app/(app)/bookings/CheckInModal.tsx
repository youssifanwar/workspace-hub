"use client";

import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
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

type ApiErrorResponse = {
  error?: string;
};

function cleanPhone(value: string) {
  return value.replace(/[^\d+]/g, "").trim();
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function isValidLookupPhone(value: string) {
  return digitsOnly(value).length >= 8;
}

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

  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [existingCustomer, setExistingCustomer] = useState<
    CustomerLookupResult["customer"] | null
  >(null);

  const [customerStats, setCustomerStats] = useState<
    CustomerLookupResult["stats"] | null
  >(null);

  const [subscriptions, setSubscriptions] = useState<
    CustomerSubscription[]
  >([]);

  // ---------------------------------------------------------------------------
  // BILLING
  // ---------------------------------------------------------------------------

  const [billingMode, setBillingMode] = useState<
    "regular" | "package"
  >("regular");

  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<
    number | null
  >(null);

  // ---------------------------------------------------------------------------
  // REQUEST
  // ---------------------------------------------------------------------------

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // SUCCESS
  // ---------------------------------------------------------------------------

  const [createdSession, setCreatedSession] =
    useState<CreatedSession | null>(null);

  // ---------------------------------------------------------------------------
  // RACE-PROTECTION
  // ---------------------------------------------------------------------------

  const lookupRequestId = useRef(0);

  // ---------------------------------------------------------------------------
  // DERIVED
  // ---------------------------------------------------------------------------

  const normalizedInputPhone = cleanPhone(phone);

  const activeSubscriptions = subscriptions.filter((subscription) => {
    const remainingHours = Number.parseFloat(
      subscription.remainingHours || "0",
    );

    const expiresAtTime =
      subscription.expiresAt === null
        ? null
        : new Date(subscription.expiresAt).getTime();

    const notExpired =
      expiresAtTime === null ||
      (Number.isFinite(expiresAtTime) && expiresAtTime > Date.now());

    return (
      subscription.status === "active" &&
      notExpired &&
      Number.isFinite(remainingHours) &&
      remainingHours > 0
    );
  });

  // ---------------------------------------------------------------------------
  // CLEAR LOOKUP STATE
  // ---------------------------------------------------------------------------

  function clearCustomerLookup() {
    setExistingCustomer(null);
    setCustomerStats(null);
    setSubscriptions([]);
    setSelectedSubscriptionId(null);
    setBillingMode("regular");
  }

  // ---------------------------------------------------------------------------
  // CUSTOMER LOOKUP
  // ---------------------------------------------------------------------------

  async function lookupCustomer(suppliedPhone?: string) {
    const value = cleanPhone(suppliedPhone ?? phone);
    const requestId = ++lookupRequestId.current;

    setLookupError(null);

    if (!value || !isValidLookupPhone(value)) {
      clearCustomerLookup();
      setLookupLoading(false);
      return;
    }

    setLookupLoading(true);

    try {
      const res = await fetch(
        `/api/customers/lookup?phone=${encodeURIComponent(value)}`,
        {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        },
      );

      const data = (await res.json().catch(() => null)) as
        | CustomerLookupResult
        | ApiErrorResponse
        | null;

      if (requestId !== lookupRequestId.current) {
        return;
      }

      if (!res.ok) {
        setLookupError(
          data &&
            "error" in data &&
            typeof data.error === "string" &&
            data.error.trim()
            ? data.error
            : "Could not search for the customer.",
        );

        clearCustomerLookup();
        return;
      }

      const result = data as CustomerLookupResult;

      if (!result.found || !result.customer) {
        clearCustomerLookup();
        return;
      }

      setExistingCustomer(result.customer);
      setName(result.customer.name);
      setPhone(result.customer.phone);
      setCustomerStats(result.stats ?? null);

      const foundSubscriptions = Array.isArray(result.subscriptions)
        ? result.subscriptions
        : [];

      setSubscriptions(foundSubscriptions);

      const availableSubscriptions = foundSubscriptions.filter(
        (subscription) => {
          const remainingHours = Number.parseFloat(
            subscription.remainingHours || "0",
          );

          const expiresAtTime =
            subscription.expiresAt === null
              ? null
              : new Date(subscription.expiresAt).getTime();

          const notExpired =
            expiresAtTime === null ||
            (Number.isFinite(expiresAtTime) &&
              expiresAtTime > Date.now());

          return (
            subscription.status === "active" &&
            notExpired &&
            Number.isFinite(remainingHours) &&
            remainingHours > 0
          );
        },
      );

      if (availableSubscriptions.length === 1) {
        setBillingMode("package");
        setSelectedSubscriptionId(availableSubscriptions[0].id);
      } else {
        setBillingMode("regular");
        setSelectedSubscriptionId(null);
      }
    } catch (err) {
      if (requestId !== lookupRequestId.current) {
        return;
      }

      console.error("Customer lookup failed:", err);

      setLookupError(
        "Could not connect to the server while searching for the customer.",
      );

      clearCustomerLookup();
    } finally {
      if (requestId === lookupRequestId.current) {
        setLookupLoading(false);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // DEBOUNCED LOOKUP
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const value = normalizedInputPhone;

    if (!value) {
      lookupRequestId.current += 1;
      clearCustomerLookup();
      setLookupError(null);
      setLookupLoading(false);
      return;
    }

    if (!isValidLookupPhone(value)) {
      lookupRequestId.current += 1;
      clearCustomerLookup();
      setLookupError(null);
      setLookupLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      void lookupCustomer(value);
    }, 450);

    return () => {
      window.clearTimeout(timer);
    };
  }, [normalizedInputPhone]);

  // ---------------------------------------------------------------------------
  // SELECT BILLING MODE
  // ---------------------------------------------------------------------------

  function selectBillingMode(mode: "regular" | "package") {
    if (mode === "regular") {
      setBillingMode("regular");
      setSelectedSubscriptionId(null);
      setError(null);
      return;
    }

    if (!existingCustomer) {
      setError("A customer must already exist before using a package.");
      return;
    }

    if (activeSubscriptions.length === 0) {
      setError(
        "This customer has no active package with available hours.",
      );
      return;
    }

    setBillingMode("package");
    setError(null);

    if (
      selectedSubscriptionId === null ||
      !activeSubscriptions.some(
        (subscription) => subscription.id === selectedSubscriptionId,
      )
    ) {
      if (activeSubscriptions.length === 1) {
        setSelectedSubscriptionId(activeSubscriptions[0].id);
      } else {
        setSelectedSubscriptionId(null);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // VALIDATION
  // ---------------------------------------------------------------------------

  function validateForm() {
    const customerName = name.trim();
    const customerPhone = cleanPhone(phone);
    const phoneDigits = digitsOnly(customerPhone);

    if (!customerName) {
      return "Enter the customer name.";
    }

    if (customerName.length > 200) {
      return "Customer name is too long.";
    }

    if (!customerPhone) {
      return "Enter the customer phone number.";
    }

    if (phoneDigits.length < 8 || phoneDigits.length > 15) {
      return "Enter a valid customer phone number.";
    }

    if (billingMode !== "package") {
      return null;
    }

    if (!existingCustomer) {
      return "A customer must already exist before using a package.";
    }

    if (activeSubscriptions.length === 0) {
      return "This customer has no active package with available hours.";
    }

    if (selectedSubscriptionId === null) {
      return "Select the package to use for this session.";
    }

    const selected = activeSubscriptions.find(
      (subscription) => subscription.id === selectedSubscriptionId,
    );

    if (!selected) {
      return "The selected package is no longer available.";
    }

    const remaining = Number.parseFloat(
      selected.remainingHours || "0",
    );

    if (!Number.isFinite(remaining) || remaining <= 0) {
      return "The selected package has no remaining hours.";
    }

    return null;
  }

  // ---------------------------------------------------------------------------
  // START SESSION
  // ---------------------------------------------------------------------------

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (loading) {
      return;
    }

    setError(null);

    const validationError = validateForm();

    if (validationError) {
      setError(validationError);
      return;
    }

    const customerName = name.trim();
    const customerPhone = cleanPhone(phone);

    setLoading(true);

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          customerName,
          customerPhone,
          customerId: existingCustomer?.id ?? undefined,
          billingMode,
          subscriptionId:
            billingMode === "package"
              ? selectedSubscriptionId
              : null,
        }),
      });

      const data = (await res.json().catch(() => null)) as
        | {
            bookingId?: number;
            accessCode?: string;
            customerName?: string;
            billingMode?: "regular" | "package";
            subscriptionId?: number | null;
            error?: string;
          }
        | null;

      if (!res.ok) {
        setError(
          data?.error || "Failed to start session.",
        );
        return;
      }

      const bookingId = Number(data?.bookingId);
      const accessCode = String(data?.accessCode ?? "");

      if (
        !Number.isSafeInteger(bookingId) ||
        bookingId <= 0 ||
        !/^\d{4}$/.test(accessCode)
      ) {
        setError(
          "Session started, but the access code was not returned correctly.",
        );
        return;
      }

      const authoritativeBillingMode =
        data?.billingMode === "package" ||
        data?.billingMode === "regular"
          ? data.billingMode
          : billingMode;

      const authoritativeSubscriptionId =
        data?.subscriptionId === null ||
        data?.subscriptionId === undefined
          ? null
          : Number(data.subscriptionId);

      const safeSubscriptionId =
        authoritativeSubscriptionId !== null &&
        Number.isSafeInteger(authoritativeSubscriptionId) &&
        authoritativeSubscriptionId > 0
          ? authoritativeSubscriptionId
          : null;

      setCreatedSession({
        bookingId,
        accessCode,
        customerName: String(
          data?.customerName ?? customerName,
        ),
        billingMode: authoritativeBillingMode,
        subscriptionId: safeSubscriptionId,
      });
    } catch (err) {
      console.error("Start session failed:", err);

      setError(
        "Could not connect to the server. Please try again.",
      );
    } finally {
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

    router.push(`/bookings/${createdSession.bookingId}`);
  }

  // ---------------------------------------------------------------------------
  // CLOSE
  // ---------------------------------------------------------------------------

  function closeModal() {
    lookupRequestId.current += 1;
    setError(null);
    setLookupError(null);
    setLookupLoading(false);
    onClose();
  }

  // ===========================================================================
  // SUCCESS
  // ===========================================================================

  if (createdSession) {
    const selectedPackage =
      createdSession.subscriptionId !== null
        ? subscriptions.find(
            (subscription) =>
              subscription.id === createdSession.subscriptionId,
          ) ?? null
        : null;

    return (
      <div
        className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-started-title"
      >
        <div className="card w-full max-w-md p-6">
          <div className="text-center">
            <div className="text-xs uppercase text-emerald-600 font-semibold">
              Session Started
            </div>

            <h3
              id="session-started-title"
              className="text-2xl font-bold mt-1"
            >
              Customer checked in
            </h3>

            <p className="text-sm text-slate-500 mt-2">
              {createdSession.customerName}
            </p>

            <div className="mt-6 rounded-2xl bg-indigo-50 border border-indigo-100 p-6">
              <div className="text-sm text-indigo-700 font-semibold">
                Customer Access Code
              </div>

              <div
                className="text-5xl font-black tracking-[0.35em] text-indigo-900 mt-2"
                aria-label={`Access code ${createdSession.accessCode}`}
              >
                {createdSession.accessCode}
              </div>

              <p className="text-xs text-indigo-600 mt-3">
                Give this 4-digit code to the customer.
              </p>
            </div>

            <div className="mt-4 rounded-xl bg-slate-50 border border-slate-200 p-4 text-sm text-slate-600 text-left">
              <div className="font-semibold text-slate-800">
                Active customer session
              </div>

              <div className="mt-1">
                Session #{createdSession.bookingId}
              </div>

              <div className="mt-2">
                Billing:{" "}
                <strong>
                  {createdSession.billingMode === "package"
                    ? "Package"
                    : "Regular"}
                </strong>
              </div>

              {selectedPackage && (
                <div className="mt-2">
                  Package:{" "}
                  <strong>
                    {selectedPackage.packageName}
                  </strong>
                </div>
              )}

              <div className="mt-2">
                The customer can move between desks and meeting rooms
                without resetting the timer or invoice.
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
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-session-title"
    >
      <div className="card w-full max-w-md p-6">
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="text-xs uppercase text-indigo-600 font-semibold">
              Start Session
            </div>

            <h3
              id="customer-session-title"
              className="text-xl font-bold"
            >
              Customer session
            </h3>

            <p className="text-sm text-slate-500 mt-1">
              Search by phone to find an existing customer or create a
              new one.
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
          noValidate
        >
          <div>
            <label
              htmlFor="customer-phone"
              className="label"
            >
              Phone number
            </label>

            <input
              id="customer-phone"
              name="phone"
              className="input"
              value={phone}
              onChange={(e) => {
                const nextValue = e.target.value;

                setPhone(nextValue);
                setLookupError(null);
                setError(null);

                if (
                  existingCustomer &&
                  cleanPhone(nextValue) !==
                    cleanPhone(existingCustomer.phone)
                ) {
                  lookupRequestId.current += 1;
                  clearCustomerLookup();
                }
              }}
              onBlur={() => {
                if (isValidLookupPhone(normalizedInputPhone)) {
                  void lookupCustomer(normalizedInputPhone);
                }
              }}
              placeholder="e.g. 0100 000 0000"
              inputMode="tel"
              autoComplete="tel"
              maxLength={20}
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
              <div
                role="alert"
                className="mt-2 p-2.5 rounded-xl bg-red-50 border border-red-100 text-xs text-red-700"
              >
                {lookupError}
              </div>
            )}
          </div>

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
                    {existingCustomer.name}
                  </div>

                  <div className="text-xs text-slate-500 mt-1">
                    📞 {existingCustomer.phone}
                  </div>

                  {customerStats && (
                    <div className="grid grid-cols-3 gap-2 mt-3">
                      <Stat
                        label="Visits"
                        value={String(customerStats.visits)}
                      />

                      <Stat
                        label="Hours"
                        value={customerStats.totalHours.toFixed(2)}
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
            <div>
              <label
                htmlFor="customer-name"
                className="label"
              >
                Customer name
              </label>

              <input
                id="customer-name"
                name="name"
                className="input"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. Ahmed Ali"
                autoComplete="name"
                maxLength={200}
                required
                disabled={loading}
              />

              <p className="text-xs text-slate-400 mt-1">
                New customer — this information will be saved
                permanently.
              </p>
            </div>
          )}

          {existingCustomer && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <div className="text-xs text-slate-500">
                Customer name
              </div>

              <div className="font-semibold text-slate-800 mt-1">
                {existingCustomer.name}
              </div>
            </div>
          )}

          <div>
            <label className="label">
              Session billing
            </label>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() =>
                  selectBillingMode("regular")
                }
                disabled={loading}
                className={`rounded-xl border p-3 text-left transition ${
                  billingMode === "regular"
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
                  selectBillingMode("package")
                }
                disabled={
                  loading ||
                  !existingCustomer ||
                  activeSubscriptions.length === 0
                }
                className={`rounded-xl border p-3 text-left transition ${
                  billingMode === "package"
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
                Package billing is available for existing customers
                only.
              </p>
            )}

            {existingCustomer &&
              activeSubscriptions.length === 0 && (
                <p className="text-xs text-slate-400 mt-1">
                  This customer has no active package with available
                  hours.
                </p>
              )}
          </div>

          {billingMode === "package" &&
            activeSubscriptions.length > 0 && (
              <div>
                <label className="label">
                  Select package
                </label>

                <div className="space-y-2">
                  {activeSubscriptions.map((subscription) => {
                    const remaining = Number.parseFloat(
                      subscription.remainingHours || "0",
                    );

                    const selected =
                      selectedSubscriptionId === subscription.id;

                    return (
                      <button
                        type="button"
                        key={subscription.id}
                        onClick={() => {
                          setSelectedSubscriptionId(
                            subscription.id,
                          );
                          setError(null);
                        }}
                        disabled={loading}
                        className={`w-full rounded-2xl border p-4 text-left transition ${
                          selected
                            ? "border-indigo-500 bg-indigo-50"
                            : "border-slate-200 bg-white hover:border-indigo-300"
                        }`}
                        aria-pressed={selected}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-bold text-slate-900">
                              {subscription.packageName}
                            </div>

                            <div className="text-xs text-slate-500 mt-1">
                              {subscription.totalHours} total hours
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <div className="font-bold text-indigo-600">
                              {Number.isFinite(remaining)
                                ? remaining.toFixed(2)
                                : "0.00"}{" "}
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
                  })}
                </div>
              </div>
            )}

          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="p-3 rounded-xl bg-red-50 border border-red-100 text-sm text-red-700"
            >
              {error}
            </div>
          )}

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
              disabled={loading || lookupLoading}
              aria-busy={loading}
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

function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("en-EG", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}