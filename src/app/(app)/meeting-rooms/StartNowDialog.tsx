"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import CustomerSearchField from "./CustomerSearchField";
import type { DialogRoom } from "./ReservationDialog";

type Busy = {
  deskId: number;
  startAt: string;
  endAt: string;
  status: string;
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

function message(data: unknown, fallback: string): string {
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const key of ["error", "message", "reason"]) {
      if (typeof d[key] === "string" && d[key]) return d[key] as string;
    }
  }
  return fallback;
}

/**
 * "Start now": seats a walk-in customer immediately. Mirrors the booking
 * dialog — live price, conflict warning against reservations already
 * known to the page, and a confirm button that stays disabled until the
 * details are valid. The server remains the final authority on conflicts.
 */
export default function StartNowDialog({
  rooms,
  occupancy,
  currency,
  initialRoomId,
  maxDurationHours,
  timeZone,
  onClose,
  onStarted,
}: {
  rooms: DialogRoom[];
  occupancy: Busy[];
  currency: string;
  initialRoomId: number | null;
  maxDurationHours: number;
  timeZone: string;
  onClose: () => void;
  onStarted: (text: string) => void;
}) {
  const router = useRouter();

  const [roomId, setRoomId] = useState<number | "">(initialRoomId ?? "");
  const [hours, setHours] = useState(1);
  const [people, setPeople] = useState(1);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [packages, setPackages] = useState<OwnedPackage[]>([]);
  const [packageId, setPackageId] = useState<number | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const room = rooms.find((r) => r.id === roomId) ?? null;
  const overCapacity = room ? people > room.capacity : false;

  // Conflict against what the page already knows (re-evaluated on submit).
  const conflict = useMemo(() => {
    if (!room) return null;
    const from = Date.now();
    const to = from + hours * 3_600_000;
    return (
      occupancy
        .filter((o) => o.deskId === room.id)
        .find(
          (o) =>
            new Date(o.startAt).getTime() < to &&
            new Date(o.endAt).getTime() > from,
        ) ?? null
    );
  }, [room, hours, occupancy]);

  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });

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

  const seq = useRef(0);
  useEffect(() => {
    if (!room || overCapacity) {
      setQuote(null);
      setQuoteError(null);
      return;
    }
    const id = ++seq.current;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          deskId: String(room.id),
          attendeeCount: String(people),
          durationHours: String(hours),
        });
        if (packageId !== null) {
          params.set("packagePurchaseId", String(packageId));
        }
        const res = await fetch(`/api/meeting-rooms/pricing?${params}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = await res.json().catch(() => ({}));
        if (id !== seq.current) return;
        if (!res.ok) {
          setQuote(null);
          setQuoteError(message(data, "Could not calculate the price."));
          return;
        }
        const n = (v: unknown) => {
          const x = Number(v);
          return Number.isFinite(x) ? x : 0;
        };
        setQuoteError(null);
        setQuote({
          hourlyRate: n(data.hourlyRate),
          subtotal: n(data.subtotalAmount),
          discountPercent: n(data.packageDiscountPercent),
          discount: n(data.packageDiscountAmount),
          total: n(data.totalAmount),
          packageHours: n(data.packageHoursRequired),
        });
      } catch (e) {
        if ((e as Error)?.name !== "AbortError" && id === seq.current) {
          setQuote(null);
          setQuoteError("Could not reach the pricing service.");
        }
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [room, overCapacity, people, hours, packageId]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onClose]);

  const canStart =
    !!room &&
    !overCapacity &&
    !conflict &&
    !!name.trim() &&
    !!phone.trim() &&
    people >= 1 &&
    hours >= 1 &&
    !saving;

  async function submit() {
    if (!canStart || !room) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/meeting-rooms/walk-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          deskId: room.id,
          customerName: name.trim(),
          customerPhone: phone.trim(),
          attendeeCount: people,
          durationHours: hours,
          packagePurchaseId: packageId,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(message(data, `Could not start the session (HTTP ${res.status}).`));
        return;
      }
      onStarted(`${room.name} started for ${name.trim()} (${hours}h).`);
      onClose();
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const money = (n: number) => `${n.toFixed(2)} ${currency}`;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-now-title"
    >
      <div className="min-h-full grid place-items-center p-4">
        <div className="card w-full max-w-3xl overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <div>
              <h2 id="start-now-title" className="text-xl font-bold text-slate-900">
                Start now
              </h2>
              <p className="text-sm text-slate-500">
                Seat a walk-in customer immediately.
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

          <div className="grid md:grid-cols-[1fr_290px]">
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                  Room
                </label>
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
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Stepper
                  label="Hours"
                  value={hours}
                  min={1}
                  max={maxDurationHours}
                  disabled={saving}
                  onChange={setHours}
                />
                <Stepper
                  label="People"
                  value={people}
                  min={1}
                  max={room?.capacity ?? 99}
                  disabled={saving}
                  onChange={setPeople}
                  hint={room ? `Capacity ${room.capacity}` : undefined}
                />
              </div>

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
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                    Pay with a package
                  </label>
                  <select
                    className="select"
                    value={packageId ?? ""}
                    disabled={saving}
                    onChange={(e) =>
                      setPackageId(e.target.value ? Number(e.target.value) : null)
                    }
                  >
                    <option value="">Pay normally</option>
                    {packages.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.packageNameSnapshot ?? p.packageName ?? `Package #${p.id}`} ·{" "}
                        {Number(p.remainingHours).toFixed(2)}h left
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
                  Notes
                </label>
                <input
                  className="input"
                  maxLength={2000}
                  placeholder="Optional"
                  value={notes}
                  disabled={saving}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>
            </div>

            <aside className="bg-slate-50 border-t md:border-t-0 md:border-l border-slate-100 p-6 flex flex-col">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Summary</h3>

              <div className="rounded-xl bg-white border border-slate-200 p-4">
                <div className="font-bold text-slate-900">
                  {room?.name ?? "No room selected"}
                </div>
                <div className="text-sm text-slate-600 mt-1">
                  Starts now · {hours} {hours === 1 ? "hour" : "hours"}
                </div>
              </div>

              <div className="mt-4" aria-live="polite">
                {overCapacity && (
                  <Note tone="amber">Over capacity ({room?.capacity} max)</Note>
                )}
                {!overCapacity && conflict && (
                  <Note tone="red">
                    This room is {conflict.status === "active" ? "in use" : "booked"}{" "}
                    {fmt(conflict.startAt)}–{fmt(conflict.endAt)}. Choose another
                    room or fewer hours.
                  </Note>
                )}
                {!overCapacity && !conflict && room && (
                  <Note tone="green">Room is free for this time</Note>
                )}
                {!room && <Note tone="slate">Choose a room to begin</Note>}
              </div>

              <dl className="mt-5 space-y-2 text-sm">
                {quote ? (
                  <>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Rate</dt>
                      <dd className="font-semibold tabular-nums">
                        {money(quote.hourlyRate)} / h
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-slate-500">Subtotal</dt>
                      <dd className="font-semibold tabular-nums">
                        {money(quote.subtotal)}
                      </dd>
                    </div>
                    {quote.discount > 0 && (
                      <div className="flex justify-between">
                        <dt className="text-slate-500">
                          Package discount ({quote.discountPercent}%)
                        </dt>
                        <dd className="font-semibold text-emerald-600 tabular-nums">
                          − {money(quote.discount)}
                        </dd>
                      </div>
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
                    The price appears once a room is chosen.
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
                  disabled={!canStart}
                  onClick={submit}
                >
                  {saving ? "Starting…" : "Start session"}
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

function Stepper({
  label,
  value,
  min,
  max,
  disabled,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled?: boolean;
  hint?: string;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="btn btn-ghost !px-3"
          disabled={disabled || value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
          aria-label={`Decrease ${label}`}
        >
          −
        </button>
        <div className="flex-1 text-center font-semibold tabular-nums">{value}</div>
        <button
          type="button"
          className="btn btn-ghost !px-3"
          disabled={disabled || value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
          aria-label={`Increase ${label}`}
        >
          +
        </button>
      </div>
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function Note({
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
