"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CheckInModal({
  desk,
  currency,
  onClose,
}: {
  desk: { id: number; name: string; hourlyRate: string };
  currency: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deskId: desk.id,
        customerName: name.trim(),
        customerPhone: phone.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Failed to check in");
      setLoading(false);
      return;
    }
    router.push(`/bookings/${data.bookingId}`);
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm grid place-items-center p-4">
      <div className="card w-full max-w-md p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs uppercase text-indigo-600 font-semibold">
              Check-in
            </div>
            <h3 className="text-xl font-bold">{desk.name}</h3>
            <p className="text-sm text-slate-500">
              Rate: {parseFloat(desk.hourlyRate).toFixed(2)} {currency} / hour
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 grid place-items-center"
          >
            ✕
          </button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="label">Customer name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ahmed Ali"
              required
              autoFocus
            />
          </div>
          <div>
            <label className="label">Phone number</label>
            <input
              className="input"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 0100 000 0000"
              required
            />
          </div>
          {error && (
            <div className="p-3 rounded-xl bg-red-50 text-sm text-red-700">
              {error}
            </div>
          )}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn btn-ghost flex-1">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary flex-1" disabled={loading}>
              {loading ? "Checking in…" : "Start timer →"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
