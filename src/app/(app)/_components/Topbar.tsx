"use client";

import {
  useEffect,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import type { SessionUser } from "@/lib/auth";

export default function Topbar({
  user,
  activeShift,
}: {
  user: SessionUser;
  activeShift: {
    id: number;
    openedAt: string;
  } | null;
}) {
  const router = useRouter();

  const [now, setNow] = useState<Date | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const updateNow = () => {
      setNow(new Date());
    };

    updateNow();

    const timer = window.setInterval(updateNow, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  async function logout() {
    if (loggingOut) {
      return;
    }

    setLogoutError(null);
    setLoggingOut(true);

    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        cache: "no-store",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        let message = "Failed to log out.";

        try {
          const data = (await response.json()) as {
            error?: string;
          };

          if (
            typeof data.error === "string" &&
            data.error.trim()
          ) {
            message = data.error;
          }
        } catch {
          // Keep the generic message.
        }

        setLogoutError(message);
        return;
      }

      router.replace("/login");
      router.refresh();
    } catch (error) {
      console.error("Logout failed:", error);

      setLogoutError(
        "Could not connect to the server. Please try again.",
      );
    } finally {
      setLoggingOut(false);
    }
  }

  const openedAt = activeShift
    ? new Date(activeShift.openedAt)
    : null;

  const validOpenedAt =
    openedAt &&
    !Number.isNaN(openedAt.getTime())
      ? openedAt
      : null;

  const duration =
    validOpenedAt && now
      ? formatDuration(
          Math.max(
            0,
            now.getTime() - validOpenedAt.getTime(),
          ),
        )
      : "";

  const firstLetter =
    user.fullName.trim().charAt(0).toUpperCase() || "?";

  return (
    <header className="glass sticky top-0 z-30 px-6 py-3 flex items-center gap-4">
      {/* CURRENT DATE / TIME */}
      <div className="hidden md:block">
        <div className="text-xs text-slate-500">
          {now
            ? now.toLocaleDateString(undefined, {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
              })
            : ""}
        </div>

        <div className="text-lg font-semibold text-slate-800 tabular-nums">
          {now
            ? now.toLocaleTimeString()
            : "--:--:--"}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* SHIFT STATUS */}
        {activeShift ? (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold">
            <span
              className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"
              aria-hidden="true"
            />

            <span>
              Shift #{activeShift.id}
              {duration ? ` · ${duration}` : ""}
            </span>
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold">
            <span
              className="w-2 h-2 rounded-full bg-amber-500"
              aria-hidden="true"
            />

            <span>
              No active shift
            </span>
          </div>
        )}

        {/* USER */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white border border-slate-200">
          <div
            className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-cyan-400 grid place-items-center text-white font-bold text-sm"
            aria-hidden="true"
          >
            {firstLetter}
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

        {/* LOGOUT */}
        <button
          type="button"
          onClick={() => void logout()}
          className="btn btn-ghost !py-2 !px-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={loggingOut}
          aria-busy={loggingOut}
        >
          {loggingOut
            ? "Logging out…"
            : "Logout ↗"}
        </button>
      </div>

      {/* LOGOUT ERROR */}
      {logoutError && (
        <div
          role="alert"
          aria-live="polite"
          className="fixed right-6 top-20 z-50 max-w-sm rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-lg"
        >
          {logoutError}
        </div>
      )}
    </header>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);

  const hours = Math.floor(
    totalSeconds / 3600,
  );

  const minutes = Math.floor(
    (totalSeconds % 3600) / 60,
  );

  const seconds =
    totalSeconds % 60;

  return [
    String(hours).padStart(2, "0"),
    String(minutes).padStart(2, "0"),
    String(seconds).padStart(2, "0"),
  ].join(":");
}