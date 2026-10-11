"use client";

import { useEffect, useRef, useState } from "react";

export type CustomerMatch = {
  id: number;
  name: string;
  phone: string;
  email: string | null;
  balance?: number;
  visits?: number;
  totalHours?: number;
};

type Match = CustomerMatch;

export default function CustomerSearchField({
  name = "",
  phone = "",
  onPick,
  onNameChange,
  onPhoneChange,
  disabled,
  compact = false,
  label = "Find an existing customer (optional)",
}: {
  name?: string;
  phone?: string;
  onPick: (customer: Match) => void;
  onNameChange?: (value: string) => void;
  onPhoneChange?: (value: string) => void;
  disabled?: boolean;
  /** Search box only — no separate name/phone inputs. */
  compact?: boolean;
  label?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Match[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const requestId = useRef(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/customers/search?q=${encodeURIComponent(query.trim())}`,
        );
        const data = await res.json().catch(() => ({}));
        if (id !== requestId.current) return;
        setResults(data.customers ?? []);
      } catch {
        if (id === requestId.current) setResults([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <div ref={boxRef} className="relative">
      <label className="block text-sm font-semibold text-slate-700 mb-1">
        {label}
      </label>
      <input
        className="input w-full"
        placeholder="Search by name or phone…"
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-slate-200 bg-white shadow-lg max-h-56 overflow-y-auto">
          {loading ? (
            <div className="p-3 text-sm text-slate-400">Searching…</div>
          ) : results.length === 0 ? (
            <div className="p-3 text-sm text-slate-400">
              {compact
                ? "No match — type the phone number below to register a new customer."
                : "No match — a new customer will be created with the name/phone below."}
            </div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-slate-50 text-sm"
                onClick={() => {
                  onPick(c);
                  setQuery(`${c.name} — ${c.phone}`);
                  setOpen(false);
                }}
              >
                <div className="font-semibold">{c.name}</div>
                <div className="text-slate-500 text-xs">{c.phone}</div>
                {(c.visits !== undefined || c.totalHours !== undefined) && (
                  <div className="text-xs text-indigo-600 mt-0.5">
                    {c.visits ?? 0} visit{(c.visits ?? 0) === 1 ? "" : "s"} ·{" "}
                    {(c.totalHours ?? 0).toFixed(1)} h stayed
                    {c.balance !== undefined && c.balance > 0
                      ? ` · balance ${c.balance.toFixed(2)}`
                      : ""}
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      )}

      {!compact && (
      <div className="grid grid-cols-2 gap-2 mt-2">
        <input
          className="input"
          placeholder="Customer name"
          value={name}
          disabled={disabled}
          onChange={(e) => onNameChange?.(e.target.value)}
        />
        <input
          className="input"
          placeholder="Phone"
          value={phone}
          disabled={disabled}
          onChange={(e) => onPhoneChange?.(e.target.value)}
        />
      </div>
      )}
    </div>
  );
}
