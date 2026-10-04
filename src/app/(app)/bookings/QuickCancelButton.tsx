"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function QuickCancelButton({
  bookingId,
  label = "Cancel session",
}: {
  bookingId: number;
  label?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (busy) return;
    if (
      !confirm(
        "Cancel this session? It will be removed and nothing will be charged.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data?.error || "Could not cancel this session.");
        return;
      }
      router.refresh();
    } catch {
      alert("Network error. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={cancel}
      disabled={busy}
      className="btn btn-ghost text-red-600 w-full"
    >
      {busy ? "Cancelling…" : `✕ ${label}`}
    </button>
  );
}
