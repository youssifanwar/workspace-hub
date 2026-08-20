"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CheckInModal from "./CheckInModal";

type Desk = {
  id: number;
  name: string;
  hourlyRate: string;
  type: "desk" | "meeting_room";
};

type ActiveBooking = {
  id: number;
  customerName: string;
  customerPhone: string;
  checkedInAt: string;
  hourlyRate: string;
};

export default function DeskGrid({
  desks,
  occupancy,
  currency,
}: {
  desks: Desk[];
  occupancy: Record<number, ActiveBooking>;
  currency: string;
}) {
  const [now, setNow] = useState<Date | null>(null);
  const [checkInDesk, setCheckInDesk] = useState<Desk | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {desks.map((d) => {
          const occ = occupancy[d.id];
          if (!occ) {
            return (
              <button
                key={d.id}
                onClick={() => setCheckInDesk(d)}
                className="group aspect-square rounded-2xl border-2 border-dashed border-slate-300 bg-white hover:border-indigo-400 hover:bg-indigo-50 transition p-4 flex flex-col items-center justify-center gap-2"
              >
                <div className="w-14 h-14 rounded-2xl bg-slate-100 group-hover:bg-indigo-100 grid place-items-center text-2xl transition">
                  🪑
                </div>
                <div className="font-bold text-slate-800">{d.name}</div>
                <div className="text-xs text-slate-500">
                  {parseFloat(d.hourlyRate).toFixed(0)} {currency}/h
                </div>
                <div className="mt-1 text-[11px] font-semibold text-indigo-600 opacity-0 group-hover:opacity-100 transition">
                  + Check in
                </div>
              </button>
            );
          }
          const startMs = new Date(occ.checkedInAt).getTime();
          const nowMs = now?.getTime() ?? startMs;
          const durationMs = Math.max(0, nowMs - startMs);
          const durationH = durationMs / 3_600_000;
          const currentCharge = durationH * parseFloat(occ.hourlyRate);
          const durStr = formatDur(durationMs);

          return (
            <Link
              key={d.id}
              href={`/bookings/${occ.id}`}
              className="aspect-square rounded-2xl p-4 flex flex-col justify-between text-white transition hover:scale-[1.02] bg-gradient-to-br from-red-500 via-rose-500 to-pink-500 shadow-lg"
            >
              <div>
                <div className="flex items-center justify-between">
                  <div className="text-2xl">🧑‍💻</div>
                  <span className="text-[10px] uppercase font-bold bg-white/20 rounded-full px-2 py-0.5">
                    Busy
                  </span>
                </div>
                <div className="font-bold mt-2 truncate">{d.name}</div>
                <div className="text-xs opacity-90 truncate">
                  {occ.customerName}
                </div>
              </div>
              <div>
                <div className="text-xs opacity-80">Elapsed</div>
                <div className="text-lg font-bold tabular-nums">{durStr}</div>
                <div className="text-xs opacity-90 tabular-nums">
                  {currentCharge.toFixed(2)} {currency}
                </div>
              </div>
            </Link>
          );
        })}
      </div>

      {checkInDesk && (
        <CheckInModal
          desk={checkInDesk}
          currency={currency}
          onClose={() => setCheckInDesk(null)}
        />
      )}
    </>
  );
}

function formatDur(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
