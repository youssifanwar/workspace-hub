"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth";

export default function Topbar({
  user,
  activeShift,
}: {
  user: SessionUser;
  activeShift: { id: number; openedAt: string } | null;
}) {
  const router = useRouter();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const openedAt = activeShift ? new Date(activeShift.openedAt) : null;
  const duration = openedAt && now ? formatDuration(now.getTime() - openedAt.getTime()) : "";

  return (
    <header className="glass sticky top-0 z-30 px-6 py-3 flex items-center gap-4">
      <div className="hidden md:block">
        <div className="text-xs text-slate-500">
          {now ? now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }) : ""}
        </div>
        <div className="text-lg font-semibold text-slate-800 tabular-nums">
          {now ? now.toLocaleTimeString() : "--:--:--"}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {activeShift ? (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Shift #{activeShift.id} · {duration}
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-amber-500" />
            No active shift
          </div>
        )}

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 grid place-items-center text-white font-bold text-sm">
            {user.fullName.charAt(0).toUpperCase()}
          </div>
          <div className="text-sm">
            <div className="font-semibold text-slate-800 leading-tight">
              {user.fullName}
            </div>
            <div className="text-[11px] text-slate-500 leading-tight">
              @{user.username}
            </div>
          </div>
        </div>

        <button onClick={logout} className="btn btn-ghost !py-2 !px-3 text-sm">
          Logout ↗
        </button>
      </div>
    </header>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(
    sec,
  ).padStart(2, "0")}`;
}
