"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import CustomerSearchField from "../CustomerSearchField";
import { useFmt } from "@/lib/lang-context";

type Room = {
  id: number;
  name: string;
  hourlyRate: string;
  capacity: number;
};

type OwnedPackage = {
  id: number;
  packageNameSnapshot?: string;
  packageName?: string;
  remainingHours: number | string;
  status: string;
  expiresAt?: string | null;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function toDateInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function toTimeInput(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function QuickBookModal({
  rooms,
  initialRoomId,
  initialStart,
  maxDurationHours,
  onClose,
}: {
  rooms: Room[];
  initialRoomId: number | null;
  initialStart: Date;
  maxDurationHours: number;
  onClose: () => void;
}) {
  const f = useFmt();
  const tx = f.t;
  const router = useRouter();

  const [roomId, setRoomId] = useState<number | "">(
    initialRoomId ?? (rooms.length === 1 ? rooms[0].id : ""),
  );
  const [date, setDate] = useState(toDateInput(initialStart));
  const [time, setTime] = useState(toTimeInput(initialStart));
  const [duration, setDuration] = useState("1");
  const [people, setPeople] = useState("1");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly">(
    "none",
  );
  const [count, setCount] = useState("2");
  const [notes, setNotes] = useState("");

  const [packages, setPackages] = useState<OwnedPackage[]>([]);
  const [packageId, setPackageId] = useState<number | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const room = rooms.find((r) => r.id === roomId) ?? null;

  // Load the customer's packages whenever a phone is chosen/typed fully.
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
        /* aborted or offline — packages are optional */
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [phone]);

  async function submit() {
    if (saving) return;
    setError(null);

    if (!room) return setError(tx("Choose a room."));
    if (!name.trim()) return setError(tx("Customer name is required."));
    if (!phone.trim()) return setError(tx("Customer phone is required."));

    const hours = Number(duration);
    if (!Number.isInteger(hours) || hours < 1) {
      return setError(tx("Duration must be a whole number of hours."));
    }
    const attendeeCount = Number(people);
    if (!Number.isInteger(attendeeCount) || attendeeCount < 1) {
      return setError(tx("Number of people must be at least 1."));
    }
    if (attendeeCount > room.capacity) {
      return setError(`${room.name} holds up to ${room.capacity} people.`);
    }

    const start = new Date(`${date}T${time}:00`);
    if (Number.isNaN(start.getTime())) return setError(tx("Invalid date or time."));
    const end = new Date(start.getTime() + hours * 3_600_000);

    let occurrences = 1;
    if (recurrence !== "none") {
      occurrences = Number(count);
      if (!Number.isInteger(occurrences) || occurrences < 2 || occurrences > 52) {
        return setError(tx("Repeat count must be between 2 and 52."));
      }
    }

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
          attendeeCount,
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
        setError(data?.error || tx("Could not create the reservation."));
        return;
      }
      onClose();
      router.refresh();
    } catch {
      setError(tx("Network error. Try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
      <div className="card w-full max-w-xl max-h-[92vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-start justify-between">
          <h2 className="text-xl font-bold">{tx("New reservation")}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            ✕
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">{tx("Room")}</label>
            <select
              className="select"
              value={roomId}
              disabled={saving}
              onChange={(e) =>
                setRoomId(e.target.value ? Number(e.target.value) : "")
              }
            >
              <option value="">{tx("Select room…")}</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} (up to {r.capacity})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">{tx("Date")}</label>
            <input
              type="date"
              className="input"
              value={date}
              disabled={saving}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="label">{tx("Start time")}</label>
            <input
              type="time"
              className="input"
              value={time}
              step={900}
              disabled={saving}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>

          <div>
            <label className="label">{tx("Duration (hours)")}</label>
            <select
              className="select"
              value={duration}
              disabled={saving}
              onChange={(e) => setDuration(e.target.value)}
            >
              {Array.from({ length: maxDurationHours }, (_, i) => i + 1).map(
                (h) => (
                  <option key={h} value={h}>
                    {h} {h === 1 ? tx("hour") : tx("hours")}
                  </option>
                ),
              )}
            </select>
          </div>
          <div>
            <label className="label">{tx("People")}</label>
            <input
              type="number"
              min={1}
              max={room?.capacity ?? undefined}
              className="input"
              value={people}
              disabled={saving}
              onChange={(e) => setPeople(e.target.value)}
            />
          </div>
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
            <label className="label">{tx("Pay with a package (optional)")}</label>
            <select
              className="select"
              value={packageId ?? ""}
              disabled={saving}
              onChange={(e) =>
                setPackageId(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">{tx("Pay normally")}</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.packageNameSnapshot ?? p.packageName ?? `${tx("Package")} #${p.id}`}{" "}
                  — {Number(p.remainingHours).toFixed(2)}h left
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">{tx("Repeat")}</label>
            <select
              className="select"
              value={recurrence}
              disabled={saving}
              onChange={(e) =>
                setRecurrence(e.target.value as "none" | "daily" | "weekly")
              }
            >
              <option value="none">{tx("Does not repeat")}</option>
              <option value="daily">{tx("Every day")}</option>
              <option value="weekly">{tx("Every week")}</option>
            </select>
          </div>
          {recurrence !== "none" && (
            <div>
              <label className="label">
                {tx("Number of")} {recurrence === "daily" ? tx("days") : tx("weeks")}
              </label>
              <input
                type="number"
                min={2}
                max={52}
                className="input"
                value={count}
                disabled={saving}
                onChange={(e) => setCount(e.target.value)}
              />
            </div>
          )}
        </div>

        <div>
          <label className="label">{tx("Notes (optional)")}</label>
          <input
            className="input"
            maxLength={2000}
            value={notes}
            disabled={saving}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && (
          <div role="alert" className="text-sm text-red-600 bg-red-50 rounded-lg p-2">
            {tx(error)}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {tx("Cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving}
            onClick={submit}
          >
            {saving ? tx("Saving…") : tx("Save reservation")}
          </button>
        </div>
      </div>
    </div>
  );
}
