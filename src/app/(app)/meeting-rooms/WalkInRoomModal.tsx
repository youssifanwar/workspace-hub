"use client";

import {
  useMemo,
  useState,
} from "react";

type PricingTier = {
  id: number;
  minPeople: number;
  maxPeople: number;
  hourlyRate: string;
  active: boolean;
};

type Room = {
  id: number;
  name: string;
  hourlyRate: string;
  capacity?: number;
  pricingTiers?: PricingTier[];
};

type CustomerPackage = {
  id: number;
  customerId: number;
  packageId: number;
  packageNameSnapshot: string;
  totalHoursSnapshot: string;
  discountPercentSnapshot: string;
  priceSnapshot: string;
  purchasedAt: string;
  startsAt: string;
  expiresAt: string | null;
  status:
    | "active"
    | "exhausted"
    | "expired"
    | "cancelled";
  remainingHours: string;
};

type ApiErrorPayload = {
  error?: unknown;
  message?: unknown;
  reason?: unknown;
  detail?: unknown;
  details?: unknown;
};

type PricePreview = {
  hourlyRate: string;
  durationHours: number;
  attendeeCount: number;
  subtotalAmount: string;
  packageDiscountPercent: string;
  packageDiscountAmount: string;
  totalAmount: string;
  packageHoursRequired: string;
  packageRemainingHours: string | null;
};

type Props = {
  room: Room;
  currency: string;
  onClose: () => void;
};

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function getErrorMessage(
  data: unknown,
  fallback: string,
): string {
  if (!isRecord(data)) {
    return fallback;
  }

  const payload =
    data as ApiErrorPayload;

  const candidates = [
    payload.error,
    payload.message,
    payload.reason,
    payload.detail,
    payload.details,
  ];

  for (const candidate of candidates) {
    if (
      typeof candidate === "string" &&
      candidate.trim()
    ) {
      return candidate.trim();
    }

    if (
      isRecord(candidate) &&
      typeof candidate.message === "string" &&
      candidate.message.trim()
    ) {
      return candidate.message.trim();
    }
  }

  return fallback;
}

async function readJson(
  response: Response,
): Promise<unknown> {
  const contentType =
    response.headers.get("content-type") ?? "";

  if (
    !contentType
      .toLowerCase()
      .includes("application/json")
  ) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function safeNumber(
  value: unknown,
  fallback = 0,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number(value)
      : NaN;

  return Number.isFinite(parsed)
    ? parsed
    : fallback;
}

export default function WalkInRoomModal({
  room,
  currency,
  onClose,
}: Props) {
  const [
    customerName,
    setCustomerName,
  ] = useState("");

  const [
    customerPhone,
    setCustomerPhone,
  ] = useState("");

  const [
    attendeeCount,
    setAttendeeCount,
  ] = useState("2");

  const [
    durationHours,
    setDurationHours,
  ] = useState("1");

  const [
    selectedPackageId,
    setSelectedPackageId,
  ] = useState<number | null>(null);

  const [
    customerPackages,
    setCustomerPackages,
  ] = useState<CustomerPackage[]>(
    [],
  );

  const [
    loadingPackages,
    setLoadingPackages,
  ] = useState(false);

  const [
    packageError,
    setPackageError,
  ] = useState<string | null>(null);

  const [notes, setNotes] =
    useState("");

  const [
    loadingPrice,
    setLoadingPrice,
  ] = useState(false);

  const [
    loadingStart,
    setLoadingStart,
  ] = useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [success, setSuccess] =
    useState<string | null>(null);

  const [
    pricePreview,
    setPricePreview,
  ] = useState<PricePreview | null>(
    null,
  );

  const selectedPackage = useMemo(() => {
    if (selectedPackageId === null) {
      return null;
    }

    return (
      customerPackages.find(
        (pkg) =>
          pkg.id ===
          selectedPackageId,
      ) ?? null
    );
  }, [
    customerPackages,
    selectedPackageId,
  ]);

  const people = Number(
    attendeeCount,
  );

  const hours = Number(
    durationHours,
  );

  const selectedTier = useMemo(() => {
    if (
      !Number.isInteger(people) ||
      people <= 0
    ) {
      return null;
    }

    return (
      room.pricingTiers?.find(
        (tier) =>
          tier.active &&
          people >= tier.minPeople &&
          people <= tier.maxPeople,
      ) ?? null
    );
  }, [
    people,
    room.pricingTiers,
  ]);

  const isBusy =
    loadingPrice ||
    loadingStart ||
    loadingPackages;

  function resetMessages() {
    setError(null);
    setSuccess(null);
  }

  function resetPrice() {
    setPricePreview(null);
  }

  async function loadCustomerPackages() {
    resetMessages();
    resetPrice();
    setPackageError(null);
    setCustomerPackages([]);
    setSelectedPackageId(null);

    const phone =
      customerPhone.trim();

    if (!phone) {
      setPackageError(
        "Enter the customer phone number first.",
      );
      return;
    }

    setLoadingPackages(true);

    try {
      const params =
        new URLSearchParams({
          phone,
        });

      const response =
        await fetch(
          `/api/meeting-rooms/packages/customer?${params.toString()}`,
          {
            method: "GET",
            cache: "no-store",
            headers: {
              Accept:
                "application/json",
            },
          },
        );

      const data =
        await readJson(response);

      if (!response.ok) {
        setPackageError(
          getErrorMessage(
            data,
            `Could not load customer packages (HTTP ${response.status}).`,
          ),
        );
        return;
      }

      const packages =
        isRecord(data) &&
        Array.isArray(data.packages)
          ? data.packages
          : [];

      setCustomerPackages(
        packages.filter(
          (pkg): pkg is CustomerPackage =>
            isRecord(pkg) &&
            typeof pkg.id === "number" &&
            typeof pkg.status ===
              "string",
        ) as CustomerPackage[],
      );
    } catch {
      setPackageError(
        "Could not connect to the customer package service.",
      );
    } finally {
      setLoadingPackages(false);
    }
  }

  function validateForm(): string | null {
    if (!customerName.trim()) {
      return "Customer name is required.";
    }

    if (!customerPhone.trim()) {
      return "Customer phone is required.";
    }

    if (
      !Number.isInteger(people) ||
      people <= 0
    ) {
      return "Number of people must be a positive whole number.";
    }

    if (
      room.capacity !== undefined &&
      people > room.capacity
    ) {
      return `This room can accommodate up to ${room.capacity} people.`;
    }

    if (
      !Number.isInteger(hours) ||
      hours <= 0
    ) {
      return "Duration must be a positive whole number of hours.";
    }

    if (
      selectedPackageId !== null
    ) {
      if (!selectedPackage) {
        return "The selected meeting room package could not be found.";
      }

      if (
        selectedPackage.status !==
        "active"
      ) {
        return "The selected meeting room package is no longer active.";
      }

      const remaining =
        Number(
          selectedPackage.remainingHours,
        );

      if (
        !Number.isFinite(remaining) ||
        remaining < hours
      ) {
        return `This package does not have enough hours. Remaining: ${
          Number.isFinite(remaining)
            ? remaining
            : 0
        } hours.`;
      }
    }

    return null;
  }

  async function calculatePrice() {
    resetMessages();
    resetPrice();

    const validation =
      validateForm();

    if (validation) {
      setError(validation);
      return;
    }

    setLoadingPrice(true);

    try {
      const params =
        new URLSearchParams({
          deskId: String(room.id),
          attendeeCount: String(
            people,
          ),
          durationHours: String(
            hours,
          ),
        });

      if (
        selectedPackageId !== null
      ) {
        params.set(
          "packagePurchaseId",
          String(
            selectedPackageId,
          ),
        );
      }

      const response =
        await fetch(
          `/api/meeting-rooms/pricing?${params.toString()}`,
          {
            method: "GET",
            cache: "no-store",
            headers: {
              Accept:
                "application/json",
            },
          },
        );

      const data =
        await readJson(response);

      if (!response.ok) {
        setError(
          getErrorMessage(
            data,
            `Could not calculate price (HTTP ${response.status}).`,
          ),
        );
        return;
      }

      if (!isRecord(data)) {
        setError(
          "The pricing service returned an invalid response.",
        );
        return;
      }

      setPricePreview({
        hourlyRate: String(
          data.hourlyRate ??
            selectedTier?.hourlyRate ??
            room.hourlyRate,
        ),

        durationHours:
          safeNumber(
            data.durationHours,
            hours,
          ),

        attendeeCount:
          safeNumber(
            data.attendeeCount,
            people,
          ),

        subtotalAmount:
          String(
            data.subtotalAmount ??
              "0.00",
          ),

        packageDiscountPercent:
          String(
            data.packageDiscountPercent ??
              "0",
          ),

        packageDiscountAmount:
          String(
            data.packageDiscountAmount ??
              "0.00",
          ),

        totalAmount:
          String(
            data.totalAmount ??
              "0.00",
          ),

        packageHoursRequired:
          String(
            data.packageHoursRequired ??
              "0.00",
          ),

        packageRemainingHours:
          data.packageRemainingHours ===
              null ||
          data.packageRemainingHours ===
              undefined
            ? null
            : String(
                data.packageRemainingHours,
              ),
      });
    } catch {
      setError(
        "Could not calculate the session price.",
      );
    } finally {
      setLoadingPrice(false);
    }
  }

  async function startNow() {
    resetMessages();

    const validation =
      validateForm();

    if (validation) {
      setError(validation);
      return;
    }

    if (!pricePreview) {
      setError(
        "Calculate the price before starting the session.",
      );
      return;
    }

    setLoadingStart(true);

    try {
      const response =
        await fetch(
          "/api/meeting-rooms/walk-in",
          {
            method: "POST",
            headers: {
              "Content-Type":
                "application/json",
              Accept:
                "application/json",
            },
            cache: "no-store",
            body: JSON.stringify({
              deskId: room.id,
              customerName:
                customerName.trim(),
              customerPhone:
                customerPhone.trim(),
              attendeeCount: people,
              durationHours: hours,
              packagePurchaseId:
                selectedPackageId,
              notes:
                notes.trim() ||
                undefined,
            }),
          },
        );

      const data =
        await readJson(response);

      if (!response.ok) {
        setError(
          getErrorMessage(
            data,
            `Could not start the meeting room session (HTTP ${response.status}).`,
          ),
        );
        return;
      }

      if (!isRecord(data)) {
        setError(
          "The walk-in service returned an invalid response.",
        );
        return;
      }

      const billing =
        isRecord(data.billing)
          ? data.billing
          : null;

      const total =
        String(
          billing?.totalAmount ??
            pricePreview.totalAmount,
        );

      const remaining =
        billing?.packageRemainingHours;

      setSuccess(
        `${room.name} started now for ${hours} hour(s). Total: ${total} ${currency}. Session is active.`,
      );

      if (
        selectedPackageId !== null &&
        remaining !== null &&
        remaining !== undefined
      ) {
        setCustomerPackages(
          (current) =>
            current.map(
              (pkg) =>
                pkg.id ===
                selectedPackageId
                  ? {
                      ...pkg,
                      remainingHours:
                        String(
                          remaining,
                        ),
                    }
                  : pkg,
            ),
        );
      }

      onClose();
    } catch {
      setError(
        "Could not start the meeting room session.",
      );
    } finally {
      setLoadingStart(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Start ${room.name} now`}
    >
      <div className="w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold tracking-wider text-emerald-600">
              WALK-IN SESSION
            </div>

            <h2 className="text-2xl font-bold text-slate-900 mt-1">
              Start {room.name} now
            </h2>

            <div className="text-sm text-slate-500 mt-1">
              The session starts immediately and
              is stored as an active meeting-room
              session.
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl"
            aria-label="Close walk-in dialog"
            disabled={isBusy}
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <div className="font-bold text-emerald-950">
              🟢 Starting now
            </div>

            <div className="text-sm text-emerald-800 mt-1">
              Availability is checked on the server
              for the current time before the room is
              opened.
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="font-bold text-slate-900 mb-3">
              Customer
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="walk-in-customer-name"
                  className="block text-sm font-semibold text-slate-700 mb-1"
                >
                  Customer name
                </label>

                <input
                  id="walk-in-customer-name"
                  className="input w-full"
                  value={customerName}
                  onChange={(event) => {
                    setCustomerName(
                      event.target.value,
                    );
                    setCustomerPackages([]);
                    setSelectedPackageId(null);
                    setPackageError(null);
                    resetMessages();
                    resetPrice();
                  }}
                  placeholder="e.g. Ahmed Ali"
                  disabled={isBusy}
                />
              </div>

              <div>
                <label
                  htmlFor="walk-in-customer-phone"
                  className="block text-sm font-semibold text-slate-700 mb-1"
                >
                  Phone number
                </label>

                <div className="flex gap-2">
                  <input
                    id="walk-in-customer-phone"
                    className="input w-full"
                    value={customerPhone}
                    onChange={(event) => {
                      setCustomerPhone(
                        event.target.value,
                      );
                      resetMessages();
                      resetPrice();
                    }}
                    placeholder="e.g. 0100 000 0000"
                    disabled={isBusy}
                  />

                  <button
                    type="button"
                    className="btn btn-ghost whitespace-nowrap"
                    onClick={() =>
                      void loadCustomerPackages()
                    }
                    disabled={isBusy}
                  >
                    {loadingPackages
                      ? "Loading..."
                      : "Load packages"}
                  </button>
                </div>

                {packageError && (
                  <div
                    className="text-xs text-red-600 mt-2"
                    role="alert"
                  >
                    {packageError}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="rounded-2xl border border-slate-200 p-4">
              <label
                htmlFor="walk-in-attendees"
                className="block text-sm font-semibold text-slate-700 mb-1"
              >
                Number of people
              </label>

              <input
                id="walk-in-attendees"
                type="number"
                min={1}
                max={
                  room.capacity ??
                  undefined
                }
                step={1}
                className="input w-full"
                value={attendeeCount}
                onChange={(event) => {
                  setAttendeeCount(
                    event.target.value,
                  );
                  resetMessages();
                  resetPrice();
                }}
                disabled={isBusy}
              />

              {selectedTier && (
                <div className="mt-3 rounded-xl bg-indigo-50 border border-indigo-100 p-3">
                  <div className="text-xs text-indigo-700">
                    Current rate
                  </div>

                  <div className="font-bold text-indigo-950 mt-1">
                    {selectedTier.hourlyRate}{" "}
                    {currency} / hour
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 p-4">
              <label
                htmlFor="walk-in-duration"
                className="block text-sm font-semibold text-slate-700 mb-1"
              >
                Duration
              </label>

              <input
                id="walk-in-duration"
                type="number"
                min={1}
                step={1}
                className="input w-full"
                value={durationHours}
                onChange={(event) => {
                  setDurationHours(
                    event.target.value,
                  );
                  resetMessages();
                  resetPrice();
                }}
                disabled={isBusy}
              />

              <div className="text-xs text-slate-500 mt-2">
                Whole hours only. The session starts
                immediately.
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="font-bold text-slate-900">
                  Meeting Room Package
                </div>

                <div className="text-xs text-slate-600 mt-1">
                  Package sessions consume room hours
                  and keep their saved discount.
                </div>
              </div>

              {customerPackages.length >
                0 && (
                <button
                  type="button"
                  className="text-xs font-semibold text-indigo-600 hover:underline"
                  onClick={() =>
                    void loadCustomerPackages()
                  }
                  disabled={isBusy}
                >
                  Refresh
                </button>
              )}
            </div>

            <select
              className="input w-full"
              value={
                selectedPackageId !==
                null
                  ? String(
                      selectedPackageId,
                    )
                  : ""
              }
              onChange={(event) => {
                const value =
                  event.target.value;

                const id = value
                  ? Number(value)
                  : null;

                setSelectedPackageId(
                  typeof id === "number" &&
                  Number.isSafeInteger(id) &&
                  id > 0
                    ? id
                    : null,
                );

                resetMessages();
                resetPrice();
              }}
              disabled={isBusy}
            >
              <option value="">
                Regular walk-in
              </option>

              {customerPackages
                .filter(
                  (pkg) =>
                    pkg.status ===
                    "active",
                )
                .map((pkg) => (
                  <option
                    key={pkg.id}
                    value={pkg.id}
                  >
                    {pkg.packageNameSnapshot} —{" "}
                    {
                      pkg.remainingHours
                    }{" "}
                    h remaining —{" "}
                    {
                      pkg.discountPercentSnapshot
                    }
                    % off
                  </option>
                ))}
            </select>

            {selectedPackage && (
              <div className="mt-3 grid sm:grid-cols-3 gap-3">
                <div className="rounded-xl bg-white border border-emerald-200 p-3">
                  <div className="text-xs text-slate-500">
                    Remaining
                  </div>

                  <div className="font-bold text-slate-900 mt-1">
                    {
                      selectedPackage.remainingHours
                    }{" "}
                    h
                  </div>
                </div>

                <div className="rounded-xl bg-white border border-emerald-200 p-3">
                  <div className="text-xs text-slate-500">
                    Discount
                  </div>

                  <div className="font-bold text-emerald-700 mt-1">
                    {
                      selectedPackage.discountPercentSnapshot
                    }
                    %
                  </div>
                </div>

                <div className="rounded-xl bg-white border border-emerald-200 p-3">
                  <div className="text-xs text-slate-500">
                    Package
                  </div>

                  <div className="font-bold text-slate-900 mt-1">
                    {
                      selectedPackage.totalHoursSnapshot
                    }{" "}
                    h
                  </div>
                </div>
              </div>
            )}

            {customerPackages.length ===
              0 &&
              !loadingPackages && (
                <div className="text-xs text-slate-500 mt-2">
                  Load customer packages using the
                  phone number above. Regular walk-in
                  remains available.
                </div>
              )}
          </div>

          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-bold text-indigo-950">
                  Price preview
                </div>

                <div className="text-xs text-indigo-700 mt-1">
                  The server recalculates the final
                  amount when the session starts.
                </div>
              </div>

              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  void calculatePrice()
                }
                disabled={isBusy}
              >
                {loadingPrice
                  ? "Calculating..."
                  : "Calculate price"}
              </button>
            </div>

            {pricePreview ? (
              <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-slate-600">
                    Hourly rate
                  </span>
                  <strong>
                    {
                      pricePreview.hourlyRate
                    }{" "}
                    {currency}
                  </strong>
                </div>

                <div className="flex justify-between gap-4">
                  <span className="text-slate-600">
                    Duration
                  </span>
                  <strong>
                    {
                      pricePreview.durationHours
                    }{" "}
                    hour(s)
                  </strong>
                </div>

                <div className="flex justify-between gap-4">
                  <span className="text-slate-600">
                    Subtotal
                  </span>
                  <strong>
                    {
                      pricePreview.subtotalAmount
                    }{" "}
                    {currency}
                  </strong>
                </div>

                {safeNumber(
                  pricePreview.packageDiscountPercent,
                ) > 0 && (
                  <div className="flex justify-between gap-4 text-emerald-700">
                    <span>
                      Package discount (
                      {
                        pricePreview.packageDiscountPercent
                      }
                      %)
                    </span>

                    <strong>
                      -{" "}
                      {
                        pricePreview.packageDiscountAmount
                      }{" "}
                      {currency}
                    </strong>
                  </div>
                )}

                <div className="border-t border-indigo-200 pt-3 mt-3 flex justify-between gap-4 text-lg">
                  <span className="font-bold text-indigo-950">
                    Total
                  </span>

                  <strong className="text-indigo-950">
                    {
                      pricePreview.totalAmount
                    }{" "}
                    {currency}
                  </strong>
                </div>
              </div>
            ) : (
              <div className="mt-4 text-sm text-indigo-700">
                Choose the attendees, duration and
                package, then calculate the price.
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="walk-in-notes"
              className="block text-sm font-semibold text-slate-700 mb-1"
            >
              Notes
            </label>

            <textarea
              id="walk-in-notes"
              className="input w-full min-h-24"
              value={notes}
              onChange={(event) => {
                setNotes(
                  event.target.value,
                );
                resetMessages();
              }}
              placeholder="Optional notes"
              maxLength={1000}
              disabled={isBusy}
            />

            <div className="text-xs text-slate-400 mt-1 text-right">
              {notes.length}/1000
            </div>
          </div>

          {success && (
            <div
              className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700 font-semibold whitespace-pre-wrap"
              role="status"
            >
              {success}
            </div>
          )}

          {error && (
            <div
              className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700 whitespace-pre-wrap"
              role="alert"
            >
              {error}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-100 flex flex-col sm:flex-row gap-3 sm:justify-end">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onClose}
            disabled={isBusy}
          >
            Close
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={() =>
              void calculatePrice()
            }
            disabled={isBusy}
          >
            {loadingPrice
              ? "Calculating..."
              : "Calculate price"}
          </button>

          <button
            type="button"
            className="btn bg-emerald-600 text-white hover:bg-emerald-700"
            onClick={() =>
              void startNow()
            }
            disabled={
              isBusy ||
              !pricePreview
            }
          >
            {loadingStart
              ? "Starting..."
              : "🟢 Start session now"}
          </button>
        </div>
      </div>
    </div>
  );
}