"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFmt } from "@/lib/lang-context";

export default function QuickCancelButton({
  bookingId,
  label = "Cancel session",
}: {
  bookingId: number;
  label?: string;
}) {
  const f = useFmt();
  const tx = f.t;
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (busy) return;
    if (
      !confirm(
        tx("Cancel this session? It will be removed and nothing will be charged."),
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
        alert(data?.error || tx("Could not cancel this session."));
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
      {busy ? tx("Cancelling…") : `✕ ${tx(label)}`}
    </button>
  );
}
