"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function toLocalInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export default function EditArrivalTime({
  bookingId,
  checkedInAt,
}: {
  bookingId: number;
  checkedInAt: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(toLocalInput(new Date(checkedInAt)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkedInAt: new Date(value).toISOString() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error || "Could not update arrival time.");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(toLocalInput(new Date(checkedInAt)));
          setOpen(true);
        }}
        className="btn btn-ghost w-full"
      >
        🕒 Edit arrival time (early / late)
      </button>
    );
  }

  return (
    <div className="border border-slate-200 rounded-xl p-3 space-y-2">
      <label className="text-sm font-medium">Actual arrival time</label>
      <input
        type="datetime-local"
        className="input w-full"
        value={value}
        max={toLocalInput(new Date())}
        onChange={(e) => setValue(e.target.value)}
      />
      <p className="text-xs text-slate-500">
        The bill is calculated from this time. Changes are logged.
      </p>
      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-ghost flex-1"
          onClick={() => setOpen(false)}
        >
          Close
        </button>
        <button
          type="button"
          className="btn btn-primary flex-1"
          disabled={saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
