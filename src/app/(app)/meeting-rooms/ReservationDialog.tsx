"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  browserTimeZone,
  toZonedDateInput,
  toZonedTimeInput,
  zonedWallTimeToDate,
} from "@/lib/zoned-time";

import CustomerSearchField from "./CustomerSearchField";

export type DialogRoom = {
  id: number;
  name: string;
  capacity: number;
};

type OwnedPackage = {
  id: number;
  packageNameSnapshot?: string;
  packageName?: string;
  remainingHours: number | string;
  status: string;
};

type Quote = {
  hourlyRate: number;
  subtotal: number;
  discountPercent: number;
  discount: number;
  total: number;
  packageHours: number;
};

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok" }
  | { state: "conflict"; message: string };

function message(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const key of ["error", "message", "reason"]) {
      if (typeof d[key] === "string" && d[key]) return d[key] as string;
    }
  }
  return fallback;
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

export default function ReservationDialog({
  rooms,
  currency,
  initialRoomId,
  initialStart,
  maxDurationHours,
  timeZone,
  onClose,
}: {
  rooms: DialogRoom[];
  currency: string;
  initialRoomId: number | null;
  initialStart: Date;
  maxDurationHours: number;
  timeZone?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  // The date/time the user types is in the WORKSPACE timezone, regardless
  // of the browser's own timezone.
  const tz = timeZone || browserTimeZone();

  const [roomId, setRoomId] = useState<number | "">(
    initialRoomId ?? (rooms.length === 1 ? rooms[0].id : ""),
  );
  const [date, setDate] = useState(toZonedDateInput(initialStart, tz));
  const [time, setTime] = useState(toZonedTimeInput(initialStart, tz));
  const [duration, setDuration] = useState(1);
  const [people, setPeople] = useState(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly">(
    "none",
  );
  const [count, setCount] = useState(4);
  const [notes, setNotes] = useState("");

  const [packages, setPackages] = useState<OwnedPackage[]>([]);
  const [packageId, setPackageId] = useState<number | null>(null);

  const [check, setCheck] = useState<Check>({ state: "idle" });
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const room = rooms.find((r) => r.id === roomId) ?? null;
  const occurrences = recurrence === "none" ? 1 : count;

  const start = useMemo(
    () => zonedWallTimeToDate(date, time, tz),
    [date, time, tz],
  );
  const end = useMemo(
    () => (start ? new Date(start.getTime() + duration * 3_600_000) : null),
    [start, duration],
  );

  const inPast = start ? start.getTime() <= Date.now() : false;
  const overCapacity = room ? people > room.capacity : false;
  const formValid =
    !!room &&
    !!start &&
    !!end &&
    !inPast &&
    !overCapacity &&
    people >= 1 &&
    duration >= 1 &&
    (recurrence === "none" || (count >= 2 && count <= 52));

  /* ---- customer packages -------------------------------------------- */
  useEffect(() => {
    setPackageId(null);
    setPackages([]);
    const trimmed = phone.trim();
    if (trimmed.replace(/\D/g, "").length < 8) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/meeting-rooms/packages/customer?phone=${encodeURIComponent(trimmed)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const data = await res.json().catch(() => ({}));
        setPackages(
          (data?.packages ?? []).filter(
            (p: OwnedPackage) =>
              p.status === "active" && Number(p.remainingHours) > 0,
          ),
        );
      } catch {
        /* optional */
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [phone]);

  /* ---- live availability + price ------------------------------------ */
  const seq = useRef(0);
  useEffect(() => {
    if (!formValid || !room || !start || !end) {
      setCheck({ state: "idle" });
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const id = ++seq.current;
    setCheck({ state: "checking" });
    setQuoteError(null);
    const controller = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const availParams = new URLSearchParams({
          deskId: String(room.id),
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          recurrence,
          recurrenceCount: String(occurrences),
        });
        const priceParams = new URLSearchParams({
          deskId: String(room.id),
          attendeeCount: String(people),
          durationHours: String(duration),
        });
        if (packageId !== null) {
          priceParams.set("packagePurchaseId", String(packageId));
        }

        const [availRes, priceRes] = await Promise.all([
          fetch(`/api/meeting-rooms/availability?${availParams}`, {
            signal: controller.signal,
            cache: "no-store",
          }),
          fetch(`/api/meeting-rooms/pricing?${priceParams}`, {
            signal: controller.signal,
            cache: "no-store",
          }),
        ]);
        const avail = await availRes.json().catch(() => ({}));
        const price = await priceRes.json().catch(() => ({}));
        if (id !== seq.current) return;

        if (!availRes.ok || avail?.available !== true) {
          setCheck({
            state: "conflict",
            message: message(
              avail,
              "This room is not available for the selected time.",
            ),
          });
        } else {
          setCheck({ state: "ok" });
        }

        if (priceRes.ok) {
          const n = (v: unknown) => {
            const x = Number(v);
            return Number.isFinite(x) ? x : 0;
          };
          const times = (v: unknown) =>
            Math.round(n(v) * occurrences * 100) / 100;
          setQuote({
            hourlyRate: n(price.hourlyRate),
            subtotal: times(price.subtotalAmount),
            discountPercent: n(price.packageDiscountPercent),
            discount: times(price.packageDiscountAmount),
            total: times(price.totalAmount),
            packageHours: n(price.packageHoursRequired) * occurrences,
          });
        } else {
          setQuote(null);
          setQuoteError(message(price, "Could not calculate the price."));
        }
      } catch (e) {
        if ((e as Error)?.name === "AbortError") return;
        if (id === seq.current) {
          setCheck({
            state: "conflict",
            message: "Could not reach the reservation service.",
          });
        }
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `room` is looked up from props that may be re-created on every
    // parent render, so depend on its id (not the object) to avoid
    // re-running the availability check needlessly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    formValid,
    room?.id,
    start?.getTime(),
    end?.getTime(),
    people,
    duration,
    recurrence,
    occurrences,
    packageId,
  ]);

  async function submit() {
    if (saving || !formValid || !room || !start || !end) return;
    if (!name.trim() || !phone.trim()) {
      setError("Enter the customer's name and phone number.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/meeting-rooms/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          deskId: room.id,
          customerName: name.trim(),
          customerPhone: phone.trim(),
          attendeeCount: people,
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          recurrence,
          recurrenceCount: occurrences,
          packagePurchaseId: packageId,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(message(data, "Could not create the reservation."));
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const fmtTime = (d: Date) =>
    d.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });
  const fmtDate = (d: Date) =>
    d.toLocaleDateString([], {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone,
    });
  const money = (n: number) => `${n.toFixed(2)} ${currency}`;

  const canConfirm =
    formValid &&
    check.state === "ok" &&
    !!name.trim() &&
    !!phone.trim() &&
    !saving;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reservation-title"
    >
      <div className="min-h-full grid place-items-center p-4">
        <div className="card w-full max-w-4xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <div>
              <h2
                id="reservation-title"
                className="text-xl font-bold text-slate-900"
              >
                New reservation
              </h2>
              <p className="text-sm text-slate-500">
                Availability and price update as you type.
              </p>
            </div>
            <button
              type="button"
              aria-label="Close"
              className="btn btn-ghost !px-3"
              onClick={onClose}
              disabled={saving}
            >
              ✕
            </button>
          </div>

          <div className="grid md:grid-cols-[1fr_320px]">
            {/* Form */}
            <div className="p-6 space-y-6">
              <section className="space-y-4">
                <h3 className="text-sm font-bold text-slate-900">
                  1 · Room &amp; time
                </h3>
                <Field label="Room">
                  <select
                    className="select"
                    value={roomId}
                    disabled={saving}
                    onChange={(e) => {
                      const v = e.target.value ? Number(e.target.value) : "";
                      setRoomId(v);
                      const r = rooms.find((x) => x.id === v);
                      if (r && people > r.capacity) setPeople(r.capacity);
                    }}
                  >
                    <option value="">Choose a room…</option>
                    {rooms.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} · up to {r.capacity} people
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Date">
                    <input
                      type="date"
                      className="input"
                      value={date}
                      disabled={saving}
                      onChange={(e) => setDate(e.target.value)}
                    />
                  </Field>
                  <Field label="Start time">
                    <input
                      type="time"
                      step={900}
                      className="input"
                      value={time}
                      disabled={saving}
                      onChange={(e) => setTime(e.target.value)}
                    />
                  </Field>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Field label="Duration">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-ghost !px-3"
                        disabled={saving || duration <= 1}
                        onClick={() => setDuration((d) => Math.max(1, d - 1))}
                        aria-label="Shorter"
                      >
                        −
                      </button>
                      <div className="flex-1 text-center font-semibold tabular-nums">
                        {duration} {duration === 1 ? "hour" : "hours"}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost !px-3"
                        disabled={saving || duration >= maxDurationHours}
                        onClick={() =>
                          setDuration((d) => Math.min(maxDurationHours, d + 1))
                        }
                        aria-label="Longer"
                      >
                        +
                      </button>
                    </div>
                  </Field>
                  <Field
                    label="People"
                    hint={room ? `Capacity ${room.capacity}` : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn btn-ghost !px-3"
                        disabled={saving || people <= 1}
                        onClick={() => setPeople((p) => Math.max(1, p - 1))}
                        aria-label="Fewer"
                      >
                        −
                      </button>
                      <div className="flex-1 text-center font-semibold tabular-nums">
                        {people}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost !px-3"
                        disabled={
                          saving || (room ? people >= room.capacity : false)
                        }
                        onClick={() => setPeople((p) => p + 1)}
                        aria-label="More"
                      >
                        +
                      </button>
                    </div>
                  </Field>
                </div>
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-bold text-slate-900">
                  2 · Customer
                </h3>
                <CustomerSearchField
                  name={name}
                  phone={phone}
                  disabled={saving}
                  onNameChange={setName}
                  onPhoneChange={setPhone}
                  onPick={(c) => {
                    setName(c.name);
                    setPhone(c.phone);
                  }}
                />
                {packages.length > 0 && (
                  <Field label="Pay with a package">
                    <select
                      className="select"
                      value={packageId ?? ""}
                      disabled={saving}
                      onChange={(e) =>
                        setPackageId(
                          e.target.value ? Number(e.target.value) : null,
                        )
                      }
                    >
                      <option value="">Pay normally</option>
                      {packages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.packageNameSnapshot ??
                            p.packageName ??
                            `Package #${p.id}`}{" "}
                          · {Number(p.remainingHours).toFixed(2)}h left
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-bold text-slate-900">
                  3 · Repeat &amp; notes
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Repeat">
                    <select
                      className="select"
                      value={recurrence}
                      disabled={saving}
                      onChange={(e) =>
                        setRecurrence(
                          e.target.value as "none" | "daily" | "weekly",
                        )
                      }
                    >
                      <option value="none">Does not repeat</option>
                      <option value="daily">Every day</option>
                      <option value="weekly">Every week</option>
                    </select>
                  </Field>
                  {recurrence !== "none" && (
                    <Field
                      label={recurrence === "daily" ? "Days" : "Weeks"}
                      hint="2 to 52"
                    >
                      <input
                        type="number"
                        min={2}
                        max={52}
                        className="input"
                        value={count}
                        disabled={saving}
                        onChange={(e) =>
                          setCount(Math.floor(Number(e.target.value) || 0))
                        }
                      />
                    </Field>
                  )}
                </div>
                <Field label="Notes">
                  <input
                    className="input"
                    maxLength={2000}
                    placeholder="Optional"
                    value={notes}
                    disabled={saving}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </Field>
              </section>
            </div>

            {/* Summary */}
            <aside className="bg-slate-50 border-t md:border-t-0 md:border-l border-slate-100 p-6 flex flex-col">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Summary</h3>

              <div className="rounded-xl bg-white border border-slate-200 p-4 space-y-1">
                <div className="font-bold text-slate-900">
                  {room?.name ?? "No room selected"}
                </div>
                {start && end ? (
                  <>
                    <div className="text-sm text-slate-600">
                      {fmtDate(start)}
                    </div>
                    <div className="text-sm font-semibold text-slate-800 tabular-nums">
                      {fmtTime(start)} – {fmtTime(end)}
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-400">Pick a date and time</div>
                )}
                {occurrences > 1 && (
                  <div className="text-xs text-indigo-600 font-semibold pt-1">
                    × {occurrences} {recurrence === "daily" ? "days" : "weeks"}
                  </div>
                )}
              </div>

              {/* Availability */}
              <div className="mt-4" aria-live="polite">
                {inPast && (
                  <Pill tone="amber">
                    The start time must be in the future. To seat someone right
                    now, use Start now.
                  </Pill>
                )}
                {overCapacity && (
                  <Pill tone="amber">
                    Over capacity ({room?.capacity} max)
                  </Pill>
                )}
                {!inPast && !overCapacity && check.state === "idle" && (
                  <Pill tone="slate">Choose a room to check availability</Pill>
                )}
                {check.state === "checking" && (
                  <Pill tone="slate">Checking availability…</Pill>
                )}
                {check.state === "ok" && (
                  <Pill tone="green">Room is available</Pill>
                )}
                {check.state === "conflict" && (
                  <Pill tone="red">{check.message}</Pill>
                )}
              </div>

              {/* Price */}
              <dl className="mt-5 space-y-2 text-sm">
                {quote ? (
                  <>
                    <Row k="Rate" v={`${money(quote.hourlyRate)} / hour`} />
                    <Row k="Subtotal" v={money(quote.subtotal)} />
                    {quote.discount > 0 && (
                      <Row
                        k={`Package discount (${quote.discountPercent}%)`}
                        v={`− ${money(quote.discount)}`}
                        accent
                      />
                    )}
                    {packageId !== null && quote.packageHours > 0 && (
                      <Row
                        k="Package hours used"
                        v={`${quote.packageHours.toFixed(2)} h`}
                      />
                    )}
                    <div className="border-t border-slate-200 pt-3 mt-3 flex items-baseline justify-between">
                      <dt className="font-bold text-slate-900">Total</dt>
                      <dd className="text-xl font-extrabold text-indigo-700 tabular-nums">
                        {money(quote.total)}
                      </dd>
                    </div>
                  </>
                ) : quoteError ? (
                  <div className="text-xs text-rose-600">{quoteError}</div>
                ) : (
                  <div className="text-xs text-slate-400">
                    The price appears once the details are complete.
                  </div>
                )}
              </dl>

              <div className="mt-auto pt-6 space-y-3">
                {error && (
                  <div
                    role="alert"
                    className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-xl p-3"
                  >
                    {error}
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn-primary w-full py-3"
                  disabled={!canConfirm}
                  onClick={submit}
                >
                  {saving ? "Saving…" : "Confirm reservation"}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost w-full"
                  disabled={saving}
                  onClick={onClose}
                >
                  Cancel
                </button>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({
  k,
  v,
  accent,
}: {
  k: string;
  v: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-slate-500">{k}</dt>
      <dd
        className={`font-semibold tabular-nums ${
          accent ? "text-emerald-600" : "text-slate-800"
        }`}
      >
        {v}
      </dd>
    </div>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "green" | "red" | "amber" | "slate";
  children: React.ReactNode;
}) {
  const styles = {
    green: "bg-emerald-50 text-emerald-700 border-emerald-200",
    red: "bg-rose-50 text-rose-700 border-rose-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    slate: "bg-white text-slate-500 border-slate-200",
  }[tone];
  return (
    <div className={`text-sm font-medium rounded-xl border px-3 py-2 ${styles}`}>
      {children}
    </div>
  );
}
