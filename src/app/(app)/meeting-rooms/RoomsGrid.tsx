"use client";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import { useRouter } from "next/navigation";

import WalkInRoomModal from "./WalkInRoomModal";

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

type ReservationModalProps = {
  room: Room;
  currency: string;
  onClose: () => void;
};

type ApiErrorPayload = {
  error?: unknown;
  message?: unknown;
  reason?: unknown;
  detail?: unknown;
  details?: unknown;
  code?: unknown;
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

  const payload = data as ApiErrorPayload;

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

function safeMoney(
  value: unknown,
  fallback = 0,
): number {
  const parsed = safeNumber(
    value,
    fallback,
  );

  if (
    !Number.isFinite(parsed) ||
    parsed < 0
  ) {
    return fallback;
  }

  const cents = Math.round(
    parsed * 100,
  );

  if (!Number.isSafeInteger(cents)) {
    return fallback;
  }

  return cents / 100;
}

export default function RoomsGrid({
  rooms,
  currency,
  canEditRate,
}: {
  rooms: Room[];
  currency: string;
  canEditRate: boolean;
}) {
  const router = useRouter();

  const [
    reservationRoom,
    setReservationRoom,
  ] = useState<Room | null>(null);

  const [
    walkInRoom,
    setWalkInRoom,
  ] = useState<Room | null>(null);

  const [editing, setEditing] =
    useState<number | null>(null);

  const [editValue, setEditValue] =
    useState("");

  const [savingRate, setSavingRate] =
    useState(false);

  const [rateError, setRateError] =
    useState<string | null>(null);

  async function saveRate(
    roomId: number,
  ) {
    setRateError(null);

    const rate = safeMoney(
      editValue,
      NaN,
    );

    if (
      !Number.isFinite(rate) ||
      rate <= 0
    ) {
      setRateError(
        "Hourly rate must be greater than zero.",
      );
      return;
    }

    setSavingRate(true);

    try {
      const response =
        await fetch(
          `/api/desks/${roomId}`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
              Accept:
                "application/json",
            },
            cache: "no-store",
            body: JSON.stringify({
              hourlyRate: rate,
            }),
          },
        );

      const data =
        await readJson(response);

      if (!response.ok) {
        setRateError(
          getErrorMessage(
            data,
            `Could not update rate (HTTP ${response.status}).`,
          ),
        );
        return;
      }

      setEditing(null);
      setEditValue("");
      router.refresh();
    } catch {
      setRateError(
        "Could not connect to the server.",
      );
    } finally {
      setSavingRate(false);
    }
  }

  return (
    <>
      <div className="space-y-8">

        <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-4">
          <div className="font-bold text-indigo-900">
            Meeting Rooms
          </div>

          <div className="text-sm text-indigo-700 mt-1">
            Pricing depends on the room,
            number of people and booking
            duration.
          </div>

          <div className="text-xs text-indigo-600 mt-2">
            Booking duration must be a whole
            number of hours. 1:30 is not
            allowed.
          </div>
        </div>

        {rateError && (
          <div
            className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700"
            role="alert"
          >
            {rateError}
          </div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {rooms.map((room) => {
            const isEditing =
              editing === room.id;

            const legacyRate = safeMoney(
              room.hourlyRate,
              0,
            );

            return (
              <div
                key={room.id}
                className="card p-6 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-400 text-white grid place-items-center text-2xl">
                    👥
                  </div>

                  <span className="badge badge-green">
                    Available
                  </span>
                </div>

                <div>
                  <div className="text-lg font-bold">
                    {room.name}
                  </div>

                  {room.capacity !==
                    undefined && (
                    <div className="text-sm text-slate-500 mt-1">
                      Capacity:{" "}
                      {room.capacity} people
                    </div>
                  )}

                  {isEditing ? (
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        className="input min-w-0"
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={editValue}
                        disabled={savingRate}
                        onChange={(event) =>
                          setEditValue(
                            event.target.value,
                          )
                        }
                        autoFocus
                      />

                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() =>
                          void saveRate(
                            room.id,
                          )
                        }
                        disabled={savingRate}
                      >
                        {savingRate
                          ? "Saving..."
                          : "Save"}
                      </button>

                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          setEditing(
                            null,
                          );
                          setEditValue("");
                        }}
                        disabled={savingRate}
                        aria-label="Cancel rate editing"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-slate-600 text-sm">
                        {legacyRate.toFixed(
                          2,
                        )}{" "}
                        {currency} / hour
                      </span>

                      {canEditRate && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(
                              room.id,
                            );
                            setEditValue(
                              legacyRate.toString(),
                            );
                            setRateError(null);
                          }}
                          className="text-xs text-indigo-600 font-semibold hover:underline"
                        >
                          ✏️ edit
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {room.pricingTiers &&
                  room.pricingTiers.length >
                    0 && (
                    <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                      <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                        Pricing
                      </div>

                      <div className="mt-2 space-y-1.5">
                        {room.pricingTiers
                          .filter(
                            (tier) =>
                              tier.active,
                          )
                          .map(
                            (tier) => (
                              <div
                                key={
                                  tier.id
                                }
                                className="flex items-center justify-between text-sm"
                              >
                                <span className="text-slate-600">
                                  {
                                    tier.minPeople
                                  }
                                  –
                                  {
                                    tier.maxPeople
                                  }{" "}
                                  people
                                </span>

                                <span className="font-semibold text-slate-900">
                                  {safeMoney(
                                    tier.hourlyRate,
                                  ).toFixed(
                                    2,
                                  )}{" "}
                                  {currency}
                                </span>
                              </div>
                            ),
                          )}
                      </div>
                    </div>
                  )}

                <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 text-sm text-slate-600">
                  <div className="font-semibold text-slate-800">
                    Physical location
                  </div>

                  <div className="mt-1">
                    Customers use the
                    reservation system to
                    book this room.
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 mt-auto">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() =>
                      setReservationRoom(
                        room,
                      )
                    }
                  >
                    📅 Reserve
                  </button>

                  <button
                    type="button"
                    className="btn bg-emerald-600 text-white hover:bg-emerald-700"
                    onClick={() =>
                      setWalkInRoom(
                        room,
                      )
                    }
                  >
                    🟢 Start Now
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {reservationRoom && (
        <ReservationModal
          room={reservationRoom}
          currency={currency}
          onClose={() =>
            setReservationRoom(null)
          }
        />
      )}

      {walkInRoom && (
        <WalkInRoomModal
          room={walkInRoom}
          currency={currency}
          onClose={() =>
            setWalkInRoom(null)
          }
        />
      )}
    </>
  );
}

function ReservationModal({
  room,
  currency,
  onClose,
}: ReservationModalProps) {
  const [customerName, setCustomerName] =
    useState("");

  const [customerPhone, setCustomerPhone] =
    useState("");

  const [attendeeCount, setAttendeeCount] =
    useState("2");

  const [startAt, setStartAt] =
    useState("");

  const [endAt, setEndAt] =
    useState("");

  const [recurrence, setRecurrence] =
    useState<
      "none" | "weekly"
    >("none");

  const [
    recurrenceCount,
    setRecurrenceCount,
  ] = useState("4");

  const [
    selectedPackageId,
    setSelectedPackageId,
  ] = useState<number | null>(null);

  const [
    customerPackages,
    setCustomerPackages,
  ] = useState<CustomerPackage[]>([]);

  const [
    loadingPackages,
    setLoadingPackages,
  ] = useState(false);

  const [
    packageLoadError,
    setPackageLoadError,
  ] = useState<string | null>(null);

  const [notes, setNotes] =
    useState("");

  const [checking, setChecking] =
    useState(false);

  const [available, setAvailable] =
    useState<boolean | null>(null);

  const [availabilityMessage, setAvailabilityMessage] =
    useState<string | null>(null);

  const [
    pricePreview,
    setPricePreview,
  ] = useState<PricePreview | null>(
    null,
  );

  const [
    loadingPrice,
    setLoadingPrice,
  ] = useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [success, setSuccess] =
    useState<string | null>(null);

  useEffect(() => {
    const current = new Date();

    current.setSeconds(0, 0);
    current.setMinutes(0);
    current.setHours(
      current.getHours() + 1,
    );

    const end = new Date(current);
    end.setHours(
      end.getHours() + 1,
    );

    setStartAt(
      toDateTimeLocal(current),
    );

    setEndAt(
      toDateTimeLocal(end),
    );
  }, []);

  function resetMessages() {
    setError(null);
    setSuccess(null);
    setAvailable(null);
    setAvailabilityMessage(null);
  }

  function resetPrice() {
    setPricePreview(null);
  }

  function getDates() {
    return {
      start: new Date(startAt),
      end: new Date(endAt),
    };
  }

  const durationHours = useMemo(() => {
    if (!startAt || !endAt) {
      return null;
    }

    const { start, end } =
      getDates();

    if (
      Number.isNaN(
        start.getTime(),
      ) ||
      Number.isNaN(
        end.getTime(),
      )
    ) {
      return null;
    }

    const milliseconds =
      end.getTime() -
      start.getTime();

    if (milliseconds <= 0) {
      return null;
    }

    return (
      milliseconds /
      (60 * 60 * 1000)
    );
  }, [startAt, endAt]);

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

  const selectedTier = useMemo(() => {
    const people = Number(
      attendeeCount,
    );

    if (
      !Number.isInteger(people) ||
      people <= 0 ||
      !room.pricingTiers
    ) {
      return null;
    }

    return (
      room.pricingTiers.find(
        (tier) =>
          tier.active &&
          people >=
            tier.minPeople &&
          people <=
            tier.maxPeople,
      ) ?? null
    );
  }, [
    attendeeCount,
    room.pricingTiers,
  ]);

  async function loadCustomerPackages() {
    setPackageLoadError(null);
    setCustomerPackages([]);
    setSelectedPackageId(null);
    resetMessages();
    resetPrice();

    const phone =
      customerPhone.trim();

    if (!phone) {
      setPackageLoadError(
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
        setPackageLoadError(
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
            typeof pkg.id === "number",
        ) as CustomerPackage[],
      );
    } catch {
      setPackageLoadError(
        "Could not connect to the customer package service.",
      );
    } finally {
      setLoadingPackages(false);
    }
  }

  async function calculatePrice() {
    resetMessages();
    resetPrice();

    const people = Number(
      attendeeCount,
    );

    if (
      !Number.isInteger(people) ||
      people <= 0
    ) {
      setError(
        "Number of people must be a positive whole number.",
      );
      return;
    }

    if (
      room.capacity !==
        undefined &&
      people > room.capacity
    ) {
      setError(
        `This room can accommodate up to ${room.capacity} people.`,
      );
      return;
    }

    if (
      durationHours === null ||
      !Number.isFinite(
        durationHours,
      )
    ) {
      setError(
        "Please choose a valid start and end time.",
      );
      return;
    }

    if (
      !Number.isInteger(
        durationHours,
      )
    ) {
      setError(
        "Meeting room duration must be a whole number of hours. 1:30 bookings are not allowed.",
      );
      return;
    }

    if (
      recurrence === "weekly"
    ) {
      const count = Number(
        recurrenceCount,
      );

      if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > 52
      ) {
        setError(
          "Number of weeks must be between 1 and 52.",
        );
        return;
      }
    }

    setLoadingPrice(true);

    try {
      const params =
        new URLSearchParams({
          deskId: String(
            room.id,
          ),
          attendeeCount: String(
            people,
          ),
          durationHours: String(
            durationHours,
          ),
        });

      if (
        selectedPackageId !==
        null
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

      const occurrenceCount =
        recurrence === "weekly"
          ? Number(
              recurrenceCount,
            )
          : 1;

      const multiplyDecimal = (
        value: unknown,
      ) => {
        const numberValue =
          Number(value);

        if (
          !Number.isFinite(
            numberValue,
          )
        ) {
          return "0.00";
        }

        return (
          Math.round(
            numberValue *
              occurrenceCount *
              100,
          ) / 100
        ).toFixed(2);
      };

      setPricePreview({
        hourlyRate: String(
          data.hourlyRate ??
            "0.00",
        ),

        durationHours:

          Number.isFinite(
            safeNumber(
              data.durationHours,
              durationHours,
            ),
          )
            ? safeNumber(
                data.durationHours,
                durationHours,
              )
            : durationHours,

        attendeeCount:
          safeNumber(
            data.attendeeCount,
            people,
          ),

        subtotalAmount:
          multiplyDecimal(
            data.subtotalAmount,
          ),

        packageDiscountPercent:
          String(
            data.packageDiscountPercent ??
              "0",
          ),

        packageDiscountAmount:
          multiplyDecimal(
            data.packageDiscountAmount,
          ),

        totalAmount:
          multiplyDecimal(
            data.totalAmount,
          ),

        packageHoursRequired:
          multiplyDecimal(
            data.packageHoursRequired,
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
        "Could not calculate the reservation price.",
      );
    } finally {
      setLoadingPrice(false);
    }
  }

  async function checkAvailability() {
    resetMessages();
    resetPrice();

    if (!startAt || !endAt) {
      setError(
        "Choose the start and end time.",
      );
      return;
    }

    const { start, end } =
      getDates();

    if (
      Number.isNaN(
        start.getTime(),
      ) ||
      Number.isNaN(
        end.getTime(),
      ) ||
      end <= start
    ) {
      setError(
        "Please enter a valid time range.",
      );
      return;
    }

    const duration =
      (end.getTime() -
        start.getTime()) /
      (60 * 60 * 1000);

    if (
      !Number.isInteger(
        duration,
      )
    ) {
      setError(
        "Meeting room duration must be a whole number of hours. 1:30 bookings are not allowed.",
      );
      return;
    }

    let count = 1;

    if (
      recurrence === "weekly"
    ) {
      count = Number(
        recurrenceCount,
      );

      if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > 52
      ) {
        setError(
          "Number of weeks must be between 1 and 52.",
        );
        return;
      }
    }

    setChecking(true);

    try {
      const params =
        new URLSearchParams({
          deskId: String(
            room.id,
          ),
          startAt:
            start.toISOString(),
          endAt:
            end.toISOString(),
          recurrence,
          recurrenceCount:
            String(count),
        });

      const response =
        await fetch(
          `/api/meeting-rooms/availability?${params.toString()}`,
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
        const reason =
          getErrorMessage(
            data,
            "",
          );

        setAvailable(false);
        setAvailabilityMessage(
          reason ||
            `Could not check availability (HTTP ${response.status}).`,
        );

        setError(
          reason ||
            `Could not check availability (HTTP ${response.status}).`,
        );

        return;
      }

      if (!isRecord(data)) {
        setAvailable(false);
        setError(
          "The availability service returned an invalid response.",
        );
        return;
      }

      const isAvailable =
        data.available === true;

      setAvailable(
        isAvailable,
      );

      if (!isAvailable) {
        const reason =
          getErrorMessage(
            data,
            "This room is not available for the selected time.",
          );

        setAvailabilityMessage(
          reason,
        );
      }
    } catch {
      setAvailable(null);
      setAvailabilityMessage(
        null,
      );
      setError(
        "Could not connect to the reservation service.",
      );
    } finally {
      setChecking(false);
    }
  }

  function validateForm(): string | null {
    const people = Number(
      attendeeCount,
    );

    if (
      !Number.isInteger(people) ||
      people <= 0
    ) {
      return "Number of people must be a positive whole number.";
    }

    if (
      room.capacity !==
        undefined &&
      people > room.capacity
    ) {
      return `This room can accommodate up to ${room.capacity} people.`;
    }

    if (
      !room.pricingTiers?.some(
        (tier) =>
          tier.active &&
          people >=
            tier.minPeople &&
          people <=
            tier.maxPeople,
      )
    ) {
      return "No pricing tier is configured for this number of people.";
    }

    if (!customerName.trim()) {
      return "Customer name is required.";
    }

    if (!customerPhone.trim()) {
      return "Customer phone is required.";
    }

    if (!startAt || !endAt) {
      return "Choose the start and end time.";
    }

    const { start, end } =
      getDates();

    if (
      Number.isNaN(
        start.getTime(),
      ) ||
      Number.isNaN(
        end.getTime(),
      )
    ) {
      return "Please enter a valid time range.";
    }

    if (end <= start) {
      return "End time must be after start time.";
    }

    if (start <= new Date()) {
      return "Reservation must be in the future.";
    }

    const duration =
      (end.getTime() -
        start.getTime()) /
      (60 * 60 * 1000);

    if (
      !Number.isInteger(
        duration,
      )
    ) {
      return "Meeting room duration must be a whole number of hours. 1:30 bookings are not allowed.";
    }

    if (
      recurrence === "weekly"
    ) {
      const count = Number(
        recurrenceCount,
      );

      if (
        !Number.isInteger(count) ||
        count < 1 ||
        count > 52
      ) {
        return "Number of weeks must be between 1 and 52.";
      }
    }

    if (
      selectedPackageId !==
      null
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

      const occurrences =
        recurrence === "weekly"
          ? Number(
              recurrenceCount,
            )
          : 1;

      const totalRequired =
        duration * occurrences;

      if (
        !Number.isFinite(
          remaining,
        ) ||
        remaining <
          totalRequired
      ) {
        return `This package does not have enough hours. Remaining: ${
          Number.isFinite(
            remaining,
          )
            ? remaining
            : 0
        } hours.`;
      }
    }

    return null;
  }

  async function reserve() {
    resetMessages();

    const validationError =
      validateForm();

    if (validationError) {
      setError(
        validationError,
      );
      return;
    }

    if (!pricePreview) {
      setError(
        "Calculate the price before confirming the reservation.",
      );
      return;
    }

    setChecking(true);

    try {
      const { start, end } =
        getDates();

      const occurrenceCount =
        recurrence === "weekly"
          ? Number(
              recurrenceCount,
            )
          : 1;

      const response =
        await fetch(
          "/api/meeting-rooms/reservations",
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

              attendeeCount:
                Number(
                  attendeeCount,
                ),

              startAt:
                start.toISOString(),

              endAt:
                end.toISOString(),

              recurrence,

              recurrenceCount:
                occurrenceCount,

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
        if (
          response.status ===
          409
        ) {
          setAvailable(false);
        }

        const message =
          getErrorMessage(
            data,
            `Could not create reservation (HTTP ${response.status}).`,
          );

        setError(message);
        return;
      }

      if (!isRecord(data)) {
        setError(
          "The reservation service returned an invalid response.",
        );
        return;
      }

      setAvailable(true);

      const billing =
        isRecord(data.billing)
          ? data.billing
          : null;

      const total = String(
        billing?.totalAmount ??
          pricePreview.totalAmount ??
          "0.00",
      );

      const discount = String(
        billing?.discountAmount ??
          pricePreview.packageDiscountAmount ??
          "0.00",
      );

      const reservedCount =
        safeNumber(
          data.recurrenceCount,
          occurrenceCount,
        );

      const discountValue =
        safeNumber(
          discount,
          0,
        );

      setSuccess(
        recurrence === "weekly"
          ? `${room.name} was reserved successfully for ${reservedCount} occurrence(s). Total: ${total} ${currency}${
              discountValue > 0
                ? ` — package discount: ${discount} ${currency}`
                : ""
            }`
          : `${room.name} was reserved successfully. Total: ${total} ${currency}${
              discountValue > 0
                ? ` — package discount: ${discount} ${currency}`
                : ""
            }`,
      );

      if (
        selectedPackageId !==
          null &&
        billing &&
        billing.packageRemainingHours !==
          null &&
        billing.packageRemainingHours !==
          undefined
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
                          billing.packageRemainingHours,
                        ),
                    }
                  : pkg,
            ),
        );
      }

      setPricePreview({
        hourlyRate: String(
          billing?.hourlyRate ??
            pricePreview.hourlyRate,
        ),

        durationHours:
          durationHours ?? 0,

        attendeeCount:
          Number(
            attendeeCount,
          ),

        subtotalAmount: String(
          billing?.subtotalAmount ??
            pricePreview.subtotalAmount,
        ),

        packageDiscountPercent:
          String(
            billing?.discountPercent ??
              pricePreview.packageDiscountPercent ??
              "0",
          ),

        packageDiscountAmount:
          String(
            billing?.discountAmount ??
              pricePreview.packageDiscountAmount,
          ),

        totalAmount: String(
          billing?.totalAmount ??
            pricePreview.totalAmount,
        ),

        packageHoursRequired:
          String(
            billing?.packageHoursUsed ??
              pricePreview.packageHoursRequired ??
              "0",
          ),

        packageRemainingHours:
          billing?.packageRemainingHours ===
            null ||
          billing?.packageRemainingHours ===
            undefined
            ? null
            : String(
                billing.packageRemainingHours,
              ),
      });
    } catch {
      setError(
        "Could not create reservation. Please try again.",
      );
    } finally {
      setChecking(false);
    }
  }

  function handleStartChange(
    value: string,
  ) {
    setStartAt(value);
    resetMessages();
    resetPrice();
  }

  function handleEndChange(
    value: string,
  ) {
    setEndAt(value);
    resetMessages();
    resetPrice();
  }

  function handleAttendeeChange(
    value: string,
  ) {
    setAttendeeCount(value);
    resetMessages();
    resetPrice();
  }

  function handlePackageChange(
    value: string,
  ) {
    const packageId = value
      ? Number(value)
      : null;

    setSelectedPackageId(
      typeof packageId === "number" &&
      Number.isSafeInteger(packageId) &&
      packageId > 0
        ? packageId
        : null,
    );

    resetMessages();
    resetPrice();
  }

  const people =
    Number(
      attendeeCount,
    );

  const isBusy =
    checking ||
    loadingPrice;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Reserve ${room.name}`}
    >
      <div className="w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-slate-200 max-h-[92vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-bold tracking-wider text-indigo-600">
              ROOM RESERVATION
            </div>

            <h2 className="text-2xl font-bold text-slate-900 mt-1">
              {room.name}
            </h2>

            <div className="text-sm text-slate-500 mt-1">
              {selectedTier
                ? safeMoney(
                    selectedTier.hourlyRate,
                  ).toFixed(2)
                : safeMoney(
                    room.hourlyRate,
                  ).toFixed(2)}{" "}
              {currency} / hour
              {room.capacity !==
                undefined && (
                <>
                  {" · "}
                  {room.capacity} people
                  max
                </>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl"
            aria-label="Close reservation dialog"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* CUSTOMER */}
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="font-bold text-slate-900 mb-3">
              Customer
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="meeting-room-customer-name"
                  className="block text-sm font-semibold text-slate-700 mb-1"
                >
                  Customer name
                </label>

                <input
                  id="meeting-room-customer-name"
                  className="input w-full"
                  value={customerName}
                  onChange={(event) => {
                    setCustomerName(
                      event.target.value,
                    );
                    setCustomerPackages(
                      [],
                    );
                    setSelectedPackageId(
                      null,
                    );
                    resetMessages();
                    resetPrice();
                  }}
                  placeholder="e.g. Ahmed Ali"
                  disabled={isBusy}
                />
              </div>

              <div>
                <label
                  htmlFor="meeting-room-customer-phone"
                  className="block text-sm font-semibold text-slate-700 mb-1"
                >
                  Phone number
                </label>

                <div className="flex gap-2">
                  <input
                    id="meeting-room-customer-phone"
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
                    disabled={
                      loadingPackages ||
                      isBusy
                    }
                  >
                    {loadingPackages
                      ? "Loading..."
                      : "Load packages"}
                  </button>
                </div>

                {packageLoadError && (
                  <div
                    className="text-xs text-red-600 mt-2"
                    role="alert"
                  >
                    {packageLoadError}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ATTENDEES */}
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="font-bold text-slate-900 mb-3">
              Attendees
            </div>

            <div className="max-w-xs">
              <label
                htmlFor="meeting-room-attendees"
                className="block text-sm font-semibold text-slate-700 mb-1"
              >
                Number of people
              </label>

              <input
                id="meeting-room-attendees"
                type="number"
                min={1}
                max={
                  room.capacity ??
                  undefined
                }
                step={1}
                className="input w-full"
                value={attendeeCount}
                onChange={(event) =>
                  handleAttendeeChange(
                    event.target.value,
                  )
                }
                disabled={isBusy}
              />

              <div className="text-xs text-slate-500 mt-1">
                {room.capacity !==
                undefined
                  ? `Maximum ${room.capacity} people`
                  : "Enter the number of attendees"}
              </div>

              {selectedTier && (
                <div className="mt-3 rounded-xl bg-indigo-50 border border-indigo-100 p-3 text-sm">
                  <div className="text-indigo-700 font-semibold">
                    Current rate
                  </div>

                  <div className="text-indigo-950 font-bold mt-1">
                    {safeMoney(
                      selectedTier.hourlyRate,
                    ).toFixed(2)}{" "}
                    {currency} / hour
                  </div>

                  <div className="text-indigo-600 text-xs mt-1">
                    For{" "}
                    {selectedTier.minPeople}–
                    {selectedTier.maxPeople}{" "}
                    people
                  </div>
                </div>
              )}

              {!selectedTier &&
                Number.isInteger(
                  people,
                ) &&
                people > 0 && (
                  <div className="mt-3 rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                    No pricing tier is
                    configured for this
                    number of people.
                  </div>
                )}
            </div>
          </div>

          {/* TIME */}
          <div className="rounded-2xl border border-slate-200 p-4">
            <div className="font-bold text-slate-900 mb-3">
              Reservation time
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="meeting-room-start"
                  className="block text-sm font-semibold text-slate-700 mb-1"
                >
                  Start
                </label>

                <input
                  id="meeting-room-start"
                  type="datetime-local"
                  className="input w-full"
                  value={startAt}
                  onChange={(event) =>
                    handleStartChange(
                      event.target.value,
                    )
                  }
                  disabled={isBusy}
                />
              </div>

              <div>
                <label
                  htmlFor="meeting-room-end"
                  className="block text-sm font-semibold text-slate-700 mb-1"
                >
                  End
                </label>

                <input
                  id="meeting-room-end"
                  type="datetime-local"
                  className="input w-full"
                  value={endAt}
                  onChange={(event) =>
                    handleEndChange(
                      event.target.value,
                    )
                  }
                  disabled={isBusy}
                />
              </div>
            </div>

            <div className="mt-3 rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
              <strong>
                Booking rule:
              </strong>{" "}
              duration must be a whole
              number of hours. 1:30 is not
              available.
            </div>

            {durationHours !== null && (
              <div className="mt-3 text-sm text-slate-600">
                Duration:{" "}
                <strong>
                  {durationHours}
                </strong>{" "}
                hour(s)
              </div>
            )}
          </div>

          {/* RECURRENCE */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="meeting-room-repeat"
                className="block text-sm font-semibold text-slate-700 mb-1"
              >
                Repeat
              </label>

              <select
                id="meeting-room-repeat"
                className="input w-full"
                value={recurrence}
                onChange={(event) => {
                  const value =
                    event.target.value;

                  setRecurrence(
                    value === "weekly"
                      ? "weekly"
                      : "none",
                  );

                  resetMessages();
                  resetPrice();
                }}
                disabled={isBusy}
              >
                <option value="none">
                  One time
                </option>

                <option value="weekly">
                  Every week
                </option>
              </select>
            </div>

            {recurrence ===
              "weekly" && (
              <div>
                <label
                  htmlFor="meeting-room-weeks"
                  className="block text-sm font-semibold text-slate-700 mb-1"
                >
                  Number of weeks
                </label>

                <input
                  id="meeting-room-weeks"
                  type="number"
                  min={1}
                  max={52}
                  step={1}
                  className="input w-full"
                  value={
                    recurrenceCount
                  }
                  onChange={(event) => {
                    setRecurrenceCount(
                      event.target.value,
                    );
                    resetMessages();
                    resetPrice();
                  }}
                  disabled={isBusy}
                />
              </div>
            )}
          </div>

          {/* PACKAGE */}
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <div className="font-bold text-slate-900">
                  Meeting Room Package
                </div>

                <div className="text-xs text-slate-600 mt-1">
                  10h = 8% · 20h = 12%
                  · 40h = 18%
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
                  disabled={
                    loadingPackages ||
                    isBusy
                  }
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
              onChange={(event) =>
                handlePackageChange(
                  event.target.value,
                )
              }
              disabled={
                loadingPackages ||
                isBusy ||
                customerPackages.length ===
                  0
              }
            >
              <option value="">
                Regular booking
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
                    {
                      pkg.packageNameSnapshot
                    }{" "}
                    —{" "}
                    {
                      pkg.remainingHours
                    }
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
                  Load the customer's
                  packages using the phone
                  number above. Regular
                  booking remains available.
                </div>
              )}
          </div>

          {/* PRICE */}
          <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="font-bold text-indigo-950">
                  Price preview
                </div>

                <div className="text-xs text-indigo-700 mt-1">
                  The final amount is
                  recalculated and validated
                  on the server.
                </div>
              </div>

              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  void calculatePrice()
                }
                disabled={
                  loadingPrice ||
                  checking
                }
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

                {selectedPackageId !==
                  null && (
                  <div className="flex justify-between gap-4 text-xs text-slate-600">
                    <span>
                      Package hours required
                    </span>

                    <strong>
                      {
                        pricePreview.packageHoursRequired
                      }{" "}
                      h
                    </strong>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 text-sm text-indigo-700">
                Choose the attendees, time
                and package, then calculate
                the price.
              </div>
            )}
          </div>

          {/* AVAILABILITY */}
          {available === true && (
            <div
              className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-700 font-semibold"
              role="status"
            >
              🟢 This room is available for
              the selected time.
            </div>
          )}

          {available === false && (
            <div
              className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700 font-semibold"
              role="alert"
            >
              🔴{" "}
              {availabilityMessage ||
                "This room is not available for the selected time."}
            </div>
          )}

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

          {/* NOTES */}
          <div>
            <label
              htmlFor="meeting-room-notes"
              className="block text-sm font-semibold text-slate-700 mb-1"
            >
              Notes
            </label>

            <textarea
              id="meeting-room-notes"
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
        </div>

        {/* FOOTER */}
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
              void checkAvailability()
            }
            disabled={isBusy}
          >
            {checking
              ? "Checking..."
              : "Check availability"}
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
            className="btn btn-primary"
            onClick={() =>
              void reserve()
            }
            disabled={isBusy}
          >
            {checking
              ? "Processing..."
              : pricePreview
              ? "Confirm reservation →"
              : "Calculate price →"}
          </button>
        </div>
      </div>
    </div>
  );
}

function toDateTimeLocal(
  date: Date,
): string {
  const pad = (
    value: number,
  ) =>
    String(value).padStart(
      2,
      "0",
    );

  return `${date.getFullYear()}-${pad(
    date.getMonth() + 1,
  )}-${pad(
    date.getDate(),
  )}T${pad(
    date.getHours(),
  )}:${pad(
    date.getMinutes(),
  )}`;
}