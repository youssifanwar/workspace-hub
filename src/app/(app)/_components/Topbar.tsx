"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import type { SessionUser } from "@/lib/auth";
import Icon from "./Icon";
import { tr, type Lang } from "@/lib/i18n-shared";

const PAGE_LABELS: Array<[string, string]> = [
  ["/dashboard", "لوحة التحكم"],
  ["/admin", "لوحة المالك"],
  ["/shift", "إدارة الشيفت"],
  ["/bookings", "الجلسات والحجوزات"],
  ["/meeting-rooms", "غرف الاجتماعات"],
  ["/orders", "طلبات المشروبات"],
  ["/menu", "المنيو والمخزون"],
  ["/fnb", "بيع مباشر"],
  ["/inventory", "المخزون"],
  ["/qr-codes", "أكواد QR"],
  ["/customers", "العملاء"],
  ["/subscription-packages", "الباقات"],
  ["/bank", "البنك"],
  ["/expenses", "المصاريف والإيرادات"],
  ["/reports", "التقارير"],
  ["/settings", "الإعدادات"],
];

export default function Topbar({
  user,
  activeShift,
  onMenuClick,
  menuOpen = false,
  lang = "ar",
}: {
  lang?: Lang;
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
    const timer = window.setInterval(updateNow, 30000);
    return () => window.clearInterval(timer);
  }, []);

  const pageTitle = useMemo(() => {
    const match = PAGE_LABELS.find(([route]) => pathname === route || pathname.startsWith(`${route}/`));
    return tr(lang, match?.[1] ?? "ورك سبيس هب");
  }, [pathname, lang]);

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
        let message = tr(lang, "تعذر تسجيل الخروج.");
        try {
          const data = (await response.json()) as { error?: string };
          if (typeof data.error === "string" && data.error.trim()) message = data.error;
        } catch {
          // keep generic message
        }
        setLogoutError(message);
        return;
      }
      router.replace("/login");
      router.refresh();
    } catch (error) {
      console.error("Logout failed:", error);
      setLogoutError(tr(lang, "مفيش اتصال بالسيرفر. جرّب تاني."));
    } finally {
      setLoggingOut(false);
    }
  }

  const openedAt = activeShift ? new Date(activeShift.openedAt) : null;
  const validOpenedAt = openedAt && !Number.isNaN(openedAt.getTime()) ? openedAt : null;
  const duration = validOpenedAt && now ? formatDuration(Math.max(0, now.getTime() - validOpenedAt.getTime())) : "";
  const firstLetter = user.fullName.trim().charAt(0).toUpperCase() || "؟";

  return (
    <header className="x-top">
      {onMenuClick && (
        <button type="button" onClick={onMenuClick} aria-label={tr(lang, menuOpen ? "إغلاق القائمة" : "فتح القائمة")} aria-controls="app-sidebar" aria-expanded={menuOpen} className="x-iconbtn x-menu-btn">
          <Icon name={menuOpen ? "close" : "menu"} size={18} />
        </button>
      )}

      <div className="x-top-title truncate">{pageTitle}</div>
      <div className="x-top-spacer" />

      {activeShift ? (
        <span className="x-chip green" title={lang === "en" ? `Shift #${activeShift.id} open for ${duration}` : `الشيفت رقم ${activeShift.id} مفتوح بقاله ${duration}`}>
          <span className="x-dot" /> {lang === "en" ? "Shift" : "شيفت"} #{activeShift.id} · <span className="x-num" dir="ltr">{duration || "..."}</span>
        </span>
      ) : (
        <span className="x-chip amber">{tr(lang, "مفيش شيفت مفتوح")}</span>
      )}

      <span className="x-chip hidden sm:inline-flex">
        <span className="x-avatar" style={{ width: 24, height: 24, borderRadius: 8, fontSize: 12 }} aria-hidden="true">{firstLetter}</span>
        {user.fullName}
      </span>

      <button
        type="button"
        className="x-chip"
        style={{ cursor: "pointer" }}
        onClick={() => {
          document.cookie = `wh_lang=${lang === "ar" ? "en" : "ar"}; path=/; max-age=31536000; samesite=lax`;
          router.refresh();
        }}
        aria-label="Language"
        title="Language / اللغة"
      >
        {lang === "ar" ? "English" : "العربية"}
      </button>

      <button type="button" onClick={() => void logout()} className="x-iconbtn" disabled={loggingOut} aria-busy={loggingOut} title={tr(lang, "تسجيل الخروج")}>
        <Icon name="logout" size={18} />
      </button>

      {logoutError && (
        <div role="alert" className="x-chip" style={{ background: "#fee2e2", color: "#991b1b" }}>
          {logoutError}
          <button type="button" onClick={() => setLogoutError(null)} aria-label={tr(lang, "إغلاق")}>×</button>
        </div>
      )}
    </header>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
