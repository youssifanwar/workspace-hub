"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function CustomerConnectPage() {
  const router = useRouter();

  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  async function connect(e: React.FormEvent) {
    e.preventDefault();

    if (loading) return;

    if (!/^\d{4}$/.test(code)) {
      setError("Enter the 4-digit access code.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        "/api/public/session/verify",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            accessCode: code,
          }),
        },
      );

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setError(
          data?.error ||
            "Could not connect this phone.",
        );
        setLoading(false);
        return;
      }

      setConnected(true);

      setTimeout(() => {
        router.replace("/customer/connected");
      }, 500);
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  if (connected) {
    return (
      <main className="min-h-screen bg-slate-50 grid place-items-center p-5">
        <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-200 p-8 text-center">
          <div className="text-6xl mb-4">✅</div>

          <h1 className="text-2xl font-bold text-slate-900">
            Phone connected
          </h1>

          <p className="text-slate-500 mt-2">
            Your phone is now connected to your active session.
          </p>

          <div className="mt-6 p-4 rounded-2xl bg-indigo-50 text-indigo-700 text-sm font-medium">
            Now scan the QR code on your desk or meeting room
            to open the menu.
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 grid place-items-center p-5">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl border border-slate-200 p-6">
        <div className="text-center">
          <div className="text-xs uppercase tracking-wider text-indigo-600 font-semibold">
            Connect device
          </div>

          <h1 className="text-3xl font-bold text-slate-900 mt-2">
            Connect your phone
          </h1>

          <p className="text-slate-500 mt-2">
            Enter the 4-digit access code given to you by the
            staff.
          </p>
        </div>

        <form onSubmit={connect} className="mt-8 space-y-4">
          <div>
            <label className="label">
              Access code
            </label>

            <input
              className="input text-center text-3xl font-bold tracking-[0.4em]"
              value={code}
              onChange={(e) =>
                setCode(
                  e.target.value
                    .replace(/\D/g, "")
                    .slice(0, 4),
                )
              }
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={4}
              placeholder="0000"
              autoFocus
              disabled={loading}
            />
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-50 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={
              loading ||
              code.length !== 4
            }
            className="w-full py-4 rounded-2xl bg-indigo-600 text-white font-bold text-lg disabled:opacity-50"
          >
            {loading
              ? "Connecting…"
              : "Connect phone"}
          </button>
        </form>
      </div>
    </main>
  );
}