"use client";

import {
  useState,
  type ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";

type Tier = {
  hours: string;
  price: string;
};

type Props = {
  currency: string;
  initialPricing: {
    tiers: Array<{ hours: number; price: number }>;
    dayPass: number;
  };
};

type SettingsResponse = {
  error?: string;
};

const DEFAULT_TIERS: Tier[] = [
  { hours: "1", price: "40" },
  { hours: "2", price: "70" },
  { hours: "3", price: "100" },
  { hours: "4", price: "130" },
];
const DEFAULT_DAY_PASS = "150";

function makeId() {
  return Math.random().toString(36).slice(2);
}

export default function CustomerSessionPricingAdmin({
  currency,
  initialPricing,
}: Props) {
  const router = useRouter();

  const initialTiers: Tier[] =
    initialPricing.tiers.length > 0
      ? initialPricing.tiers
          .slice()
          .sort((a, b) => a.hours - b.hours)
          .map((t) => ({
            hours: String(t.hours),
            price: String(t.price),
          }))
      : DEFAULT_TIERS;

  const [initialIds] = useState<string[]>(() =>
    initialTiers.map(() => makeId()),
  );
  const [rowIds, setRowIds] = useState<string[]>(initialIds);
  const [tiersById, setTiersById] = useState<
    Record<string, Tier>
  >(() =>
    Object.fromEntries(
      initialIds.map((id, i) => [id, initialTiers[i]]),
    ),
  );

  const [dayPass, setDayPass] = useState(
    String(initialPricing.dayPass || DEFAULT_DAY_PASS),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function clearMessages() {
    setError(null);
    setSuccess(null);
  }

  function updateTier(
    id: string,
    field: keyof Tier,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    setTiersById((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: event.target.value },
    }));
    clearMessages();
  }

  function addTier() {
    const id = makeId();
    setRowIds((prev) => [...prev, id]);
    setTiersById((prev) => ({
      ...prev,
      [id]: { hours: "", price: "" },
    }));
    clearMessages();
  }

  function removeTier(id: string) {
    if (rowIds.length <= 1) {
      setError("Keep at least one pricing tier.");
      return;
    }
    setRowIds((prev) => prev.filter((rowId) => rowId !== id));
    setTiersById((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    clearMessages();
  }

  function validateAndBuild():
    | { ok: true; tiers: Array<{ hours: number; price: number }> }
    | { ok: false; error: string } {
    const parsedTiers: Array<{ hours: number; price: number }> = [];
    const seenHours = new Set<number>();

    for (const id of rowIds) {
      const tier = tiersById[id];
      const hoursTrimmed = tier.hours.trim();
      const priceTrimmed = tier.price.trim();

      if (!hoursTrimmed || !priceTrimmed) {
        return { ok: false, error: "Fill in every tier's hours and price, or remove the empty row." };
      }
      if (!/^\d+$/.test(hoursTrimmed)) {
        return { ok: false, error: "Hours must be a whole number (e.g. 1, 2, 3)." };
      }
      if (!/^\d+(?:\.\d{1,2})?$/.test(priceTrimmed)) {
        return { ok: false, error: "Each price must be a valid amount with up to 2 decimal places." };
      }
      const hours = Number(hoursTrimmed);
      const price = Number(priceTrimmed);
      if (hours <= 0 || hours > 744) {
        return { ok: false, error: "Hours must be between 1 and 744 (31 days)." };
      }
      if (price < 0 || price > 1_000_000) {
        return { ok: false, error: "Each price must be between 0 and 1,000,000." };
      }
      if (seenHours.has(hours)) {
        return { ok: false, error: `You have two tiers for ${hours} hour(s). Each hour value can only appear once.` };
      }
      seenHours.add(hours);
      parsedTiers.push({ hours, price });
    }

    const dayPassTrimmed = dayPass.trim();
    if (!dayPassTrimmed || !/^\d+(?:\.\d{1,2})?$/.test(dayPassTrimmed)) {
      return { ok: false, error: "Day Pass price must be a valid amount." };
    }
    const dayPassValue = Number(dayPassTrimmed);
    if (dayPassValue < 0 || dayPassValue > 1_000_000) {
      return { ok: false, error: "Day Pass price must be between 0 and 1,000,000." };
    }

    parsedTiers.sort((a, b) => a.hours - b.hours);
    return { ok: true, tiers: parsedTiers };
  }

  async function save() {
    if (saving) return;
    clearMessages();

    const result = validateAndBuild();
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          customer_session_tiers: result.tiers,
          customer_session_day_pass: Number(dayPass),
        }),
      });

      const data = (await response
        .json()
        .catch(() => null)) as SettingsResponse | null;

      if (!response.ok) {
        setError(data?.error || "Could not save customer-session pricing.");
        return;
      }

      setSuccess("Customer-session pricing saved successfully.");
      router.refresh();
    } catch (err) {
      console.error("Save customer-session pricing error:", err);
      setError("Could not connect to the server. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function resetDefaults() {
    if (saving) return;
    const ids = DEFAULT_TIERS.map(() => makeId());
    setRowIds(ids);
    setTiersById(
      Object.fromEntries(ids.map((id, i) => [id, DEFAULT_TIERS[i]])),
    );
    setDayPass(DEFAULT_DAY_PASS);
    clearMessages();
  }

  return (
    <div className="space-y-5">
      {/* HEADER */}
      <div>
        <h3 className="font-bold text-lg">Customer Session Pricing</h3>
        <p className="text-sm text-slate-500 mt-1">
          These prices are for open-seating customer sessions only — not
          desks or meeting rooms. Add or remove tiers freely; a session is
          billed at the cheapest tier whose hours cover it, or at the Day
          Pass rate once it runs past every tier.
        </p>
      </div>

      {/* MESSAGES */}
      {error && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      {success && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"
        >
          {success}
        </div>
      )}

      {/* TIERS */}
      <div className="space-y-3">
        {rowIds.map((id) => {
          const tier = tiersById[id];
          return (
            <div
              key={id}
              className="grid grid-cols-[1fr_1fr_auto] gap-3 items-center rounded-xl border border-slate-200 p-4"
            >
              <div>
                <label className="text-xs font-semibold text-slate-500">
                  Up to (hours)
                </label>
                <input
                  type="number"
                  min="1"
                  max="744"
                  step="1"
                  inputMode="numeric"
                  value={tier.hours}
                  disabled={saving}
                  onChange={(e) => updateTier(id, "hours", e)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 font-semibold disabled:opacity-50"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500">
                  Price ({currency})
                </label>
                <input
                  type="number"
                  min="0"
                  max="1000000"
                  step="0.01"
                  inputMode="decimal"
                  value={tier.price}
                  disabled={saving}
                  onChange={(e) => updateTier(id, "price", e)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 font-semibold disabled:opacity-50"
                />
              </div>
              <button
                type="button"
                onClick={() => removeTier(id)}
                disabled={saving}
                className="mt-5 rounded-xl bg-red-50 text-red-600 px-3 py-2 font-semibold disabled:opacity-50"
                aria-label="Remove tier"
              >
                ✕
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={addTier}
          disabled={saving}
          className="rounded-xl border border-dashed border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 disabled:opacity-50"
        >
          + Add tier
        </button>
      </div>

      {/* DAY PASS */}
      <div className="grid md:grid-cols-[1fr_180px] gap-4 items-center rounded-xl border border-slate-200 p-4">
        <div>
          <div className="font-semibold text-slate-900">Day Pass</div>
          <div className="text-xs text-slate-500 mt-1">
            Billing once a session runs longer than every tier above.
          </div>
        </div>
        <div className="relative">
          <input
            type="number"
            min="0"
            max="1000000"
            step="0.01"
            inputMode="decimal"
            value={dayPass}
            disabled={saving}
            onChange={(e) => {
              setDayPass(e.target.value);
              clearMessages();
            }}
            className="w-full rounded-xl border border-slate-300 px-4 py-3 pr-16 font-semibold disabled:opacity-50"
          />
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">
            {currency}
          </span>
        </div>
      </div>

      {/* ACTIONS */}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="rounded-xl bg-indigo-600 px-5 py-3 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? "Saving…" : "Save pricing"}
        </button>
        <button
          type="button"
          onClick={resetDefaults}
          disabled={saving}
          className="rounded-xl bg-slate-100 px-5 py-3 text-slate-700 font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Restore defaults
        </button>
      </div>
    </div>
  );
}
