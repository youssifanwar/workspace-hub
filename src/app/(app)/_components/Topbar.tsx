"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import type { SessionUser } from "@/lib/auth";

const PAGE_LABELS: Array<[string, string]> = [
  ["/dashboard", "Dashboard"],
  ["/shift", "Shift management"],
  ["/bookings", "Bookings & sessions"],
  ["/meeting-rooms", "Meeting rooms"],
  ["/orders", "Live orders"],
  ["/menu", "Menu & F&B"],
  ["/fnb", "Direct F&B sale"],
  ["/inventory", "Inventory"],
  ["/qr-codes", "QR ordering"],
  ["/customers", "Customers"],
  ["/subscription-packages", "Subscriptions"],
  ["/bank", "Bank"],
  ["/expenses", "Expenses & income"],
  ["/reports", "Reports & insights"],
  ["/settings", "Settings"],
];

export default function Topbar({
  user,
  activeShift,
  onMenuClick,
  menuOpen = false,
}: {
  onMenuClick?: () => void;
  menuOpen?: boolean;
  user: SessionUser;
  activeShift: { id: number; openedAt: string } | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [now, setNow] = useState<Date | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  useEffect(() => {
    const updateNow = () => setNow(new Date());
    updateNow();
    const timer = window.setInterval(updateNow, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const pageTitle = useMemo(() => {
    const match = PAGE_LABELS.find(([route]) => pathname === route || pathname.startsWith(`${route}/`));
    return match?.[1] ?? "Workspace";
  }, [pathname]);

  async function logout() {
    if (loggingOut) return;
    setLogoutError(null);
    setLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        let message = "Failed to log out.";
        try {
          const data = (await response.json()) as { error?: string };
          if (typeof data.error === "string" && data.error.trim()) message = data.error;
        } catch {
          // Keep the generic message if the response isn't JSON.
        }
        setLogoutError(message);
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch (error) {
      console.error("Logout failed:", error);
      setLogoutError("Could not connect to the server. Please try again.");
    } finally {
      setLoggingOut(false);
    }
  }

  const openedAt = activeShift ? new Date(activeShift.openedAt) : null;
  const validOpenedAt = openedAt && !Number.isNaN(openedAt.getTime()) ? openedAt : null;
  const duration = validOpenedAt && now
    ? formatDuration(Math.max(0, now.getTime() - validOpenedAt.getTime()))
    : "";
  const firstLetter = user.fullName.trim().charAt(0).toUpperCase() || "?";

  return (
    <header className="app-topbar sticky top-0 z-30 flex items-center gap-3 sm:gap-5">
      {onMenuClick && (
        <button
          type="button"
          onClick={onMenuClick}
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-controls="app-sidebar"
          aria-expanded={menuOpen}
          className="topbar-menu-button lg:hidden"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            {menuOpen ? <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> : <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
          </svg>
        </button>
      )}

      <div className="topbar-heading min-w-0">
        <div className="topbar-eyebrow"><span className="topbar-eyebrow-dot" /> WORKSPACE HUB <span className="topbar-breadcrumb-slash">/</span> OPERATIONS</div>
        <div className="topbar-page-title truncate">{pageTitle}</div>
      </div>

      <div className="topbar-date hidden xl:flex">
        <div className="topbar-date-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none"><rect x="3.5" y="5" width="17" height="16" rx="2.5" stroke="currentColor" strokeWidth="1.6"/><path d="M7.5 3v4M16.5 3v4M4 9.5h16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
        </div>
        <div className="min-w-0">
          <div className="topbar-date-label">LOCAL DATE & TIME</div>
          <div className="topbar-date-value tabular-nums">
            {now ? `${now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} · ${now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "--"}
          </div>
        </div>
      </div>

      {activeShift ? (
        <div className="topbar-shift is-active" title={`Shift #${activeShift.id} has been open for ${duration}`}>
          <span className="topbar-shift-dot" aria-hidden="true" />
          <span className="topbar-shift-copy"><strong>Shift #{activeShift.id}</strong><small>{duration || "Active now"}</small></span>
        </div>
      ) : (
        <div className="topbar-shift is-idle">
          <span className="topbar-shift-dot" aria-hidden="true" />
          <span className="topbar-shift-copy"><strong>No active shift</strong><small>Open a shift to begin</small></span>
        </div>
      )}

      <div className="topbar-user">
        <div className="topbar-avatar" aria-hidden="true">{firstLetter}</div>
        <div className="hidden sm:block min-w-0">
          <div className="topbar-user-name truncate">{user.fullName}</div>
          <div className="topbar-user-handle truncate">@{user.username}</div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => void logout()}
        className="topbar-logout"
        disabled={loggingOut}
        aria-busy={loggingOut}
        title="Sign out"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true"><path d="M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10M14 8l4 4-4 4M8 12h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/></svg>
        <span className="hidden md:inline">{loggingOut ? "Signing out" : "Sign out"}</span>
      </button>

      {logoutError && (
        <div role="alert" aria-live="polite" className="topbar-error">
          <span>{logoutError}</span>
          <button type="button" onClick={() => setLogoutError(null)} aria-label="Dismiss error">×</button>
        </div>
      )}
    </header>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [String(hours).padStart(2, "0"), String(minutes).padStart(2, "0"), String(seconds).padStart(2, "0")].join(":");
}
