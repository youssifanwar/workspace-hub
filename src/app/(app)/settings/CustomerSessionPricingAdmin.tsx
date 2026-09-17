"use client";

import {
  useState,
  type ChangeEvent,
} from "react";
import { useRouter } from "next/navigation";

type Props = {
  currency: string;
  initialPricing: {
    oneHour: number;
    twoHours: number;
    threeHours: number;
    fourHours: number;
    dayPass: number;
  };
};

type SettingsResponse = {
  error?: string;
};

type PricingField =
  | "oneHour"
  | "twoHours"
  | "threeHours"
  | "fourHours"
  | "dayPass";

const DEFAULT_PRICING: Record<PricingField, string> = {
  oneHour: "40",
  twoHours: "70",
  threeHours: "100",
  fourHours: "130",
  dayPass: "150",
};

export default function CustomerSessionPricingAdmin({
  currency,
  initialPricing,
}: Props) {
  const router = useRouter();

  const [oneHour, setOneHour] = useState(
    String(initialPricing.oneHour),
  );

  const [twoHours, setTwoHours] = useState(
    String(initialPricing.twoHours),
  );

  const [threeHours, setThreeHours] = useState(
    String(initialPricing.threeHours),
  );

  const [fourHours, setFourHours] = useState(
    String(initialPricing.fourHours),
  );

  const [dayPass, setDayPass] = useState(
    String(initialPricing.dayPass),
  );

  const [saving, setSaving] = useState(false);

  const [error, setError] = useState<string | null>(
    null,
  );

  const [success, setSuccess] = useState<string | null>(
    null,
  );

  function validateMoney(
    label: string,
    value: string,
  ): string | null {
    const trimmed = value.trim();

    if (!trimmed) {
      return `${label} is required.`;
    }

    if (!/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
      return `${label} must be a valid amount with up to 2 decimal places.`;
    }

    const parsed = Number(trimmed);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      return `${label} must be greater than zero.`;
    }

    if (parsed > 1_000_000) {
      return `${label} is too large.`;
    }

    return null;
  }

  function clearMessages() {
    setError(null);
    setSuccess(null);
  }

  function updateField(
    setter: (value: string) => void,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    setter(event.target.value);
    clearMessages();
  }

  async function save() {
    if (saving) {
      return;
    }

    clearMessages();

    const fields = [
      ["1 hour price", oneHour],
      ["2 hours price", twoHours],
      ["3 hours price", threeHours],
      ["4 hours price", fourHours],
      ["Day Pass price", dayPass],
    ] as const;

    for (const [label, value] of fields) {
      const validation = validateMoney(label, value);

      if (validation) {
        setError(validation);
        return;
      }
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
          customer_session_1h: Number(oneHour),
          customer_session_2h: Number(twoHours),
          customer_session_3h: Number(threeHours),
          customer_session_4h: Number(fourHours),
          customer_session_day_pass: Number(dayPass),
        }),
      });

      const data = (await response
        .json()
        .catch(() => null)) as SettingsResponse | null;

      if (!response.ok) {
        setError(
          data?.error ||
            "Could not save customer-session pricing.",
        );
        return;
      }

      setSuccess(
        "Customer-session pricing saved successfully.",
      );

      router.refresh();
    } catch (error) {
      console.error(
        "Save customer-session pricing error:",
        error,
      );

      setError(
        "Could not connect to the server. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  function resetDefaults() {
    if (saving) {
      return;
    }

    setOneHour(DEFAULT_PRICING.oneHour);
    setTwoHours(DEFAULT_PRICING.twoHours);
    setThreeHours(DEFAULT_PRICING.threeHours);
    setFourHours(DEFAULT_PRICING.fourHours);
    setDayPass(DEFAULT_PRICING.dayPass);

    clearMessages();
  }

  const rows: Array<{
    key: PricingField;
    label: string;
    description: string;
    value: string;
    setValue: (value: string) => void;
  }> = [
    {
      key: "oneHour",
      label: "1 hour",
      description:
        "Billing for sessions up to 1 hour.",
      value: oneHour,
      setValue: setOneHour,
    },
    {
      key: "twoHours",
      label: "2 hours",
      description:
        "Billing when the customer reaches 2 hours.",
      value: twoHours,
      setValue: setTwoHours,
    },
    {
      key: "threeHours",
      label: "3 hours",
      description:
        "Billing when the customer reaches 3 hours.",
      value: threeHours,
      setValue: setThreeHours,
    },
    {
      key: "fourHours",
      label: "4 hours",
      description:
        "Billing when the customer reaches 4 hours.",
      value: fourHours,
      setValue: setFourHours,
    },
    {
      key: "dayPass",
      label: "Day Pass",
      description:
        "Billing for sessions exceeding 4 hours.",
      value: dayPass,
      setValue: setDayPass,
    },
  ];

  return (
    <div className="space-y-5">
      {/* HEADER */}
      <div>
        <h3 className="font-bold text-lg">
          Customer Session Pricing
        </h3>

        <p className="text-sm text-slate-500 mt-1">
          These prices are for customer sessions only.
          They are not tied to desks or meeting rooms.
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

      {/* PRICING */}
      <div className="space-y-3">
        {rows.map((row) => (
          <div
            key={row.key}
            className="grid md:grid-cols-[1fr_180px] gap-4 items-center rounded-xl border border-slate-200 p-4"
          >
            <div>
              <div className="font-semibold text-slate-900">
                {row.label}
              </div>

              <div className="text-xs text-slate-500 mt-1">
                {row.description}
              </div>
            </div>

            <div className="relative">
              <input
                id={`customer-session-${row.key}`}
                name={`customer-session-${row.key}`}
                type="number"
                min="0.01"
                max="1000000"
                step="0.01"
                inputMode="decimal"
                value={row.value}
                disabled={saving}
                onChange={(event) => {
                  updateField(
                    row.setValue,
                    event,
                  );
                }}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 pr-16 font-semibold disabled:opacity-50"
              />

              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">
                {currency}
              </span>
            </div>
          </div>
        ))}
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