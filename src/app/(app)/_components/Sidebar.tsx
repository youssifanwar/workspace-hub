"use client";

import Icon, { type IconName } from "./Icon";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/auth";
import { tr, type Lang } from "@/lib/i18n-shared";

type Group = "التشغيل" | "الكافيه والمبيعات" | "الإدارة";

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  group: Group;
  roles?: Role[];
  needsShift?: boolean;
  ownerOnly?: boolean;
};

// Same routes, shift gates and role restrictions as before; only the labels
// are now Arabic and the owner admin page was added.
const NAV: NavItem[] = [
  { href: "/dashboard", label: "لوحة التحكم", icon: "dashboard", group: "التشغيل" },
  { href: "/shift", label: "شيفتي", icon: "clock", group: "التشغيل" },
  { href: "/bookings", label: "الجلسات والحجوزات", icon: "calendar", group: "التشغيل", needsShift: true },
  { href: "/meeting-rooms", label: "غرف الاجتماعات", icon: "building", group: "التشغيل", needsShift: true },
  { href: "/orders", label: "طلبات المشروبات", icon: "bell", group: "الكافيه والمبيعات" },
  { href: "/menu", label: "المنيو والمخزون", icon: "utensils", group: "الكافيه والمبيعات" },
  { href: "/fnb", label: "بيع مباشر", icon: "receipt", group: "الكافيه والمبيعات", needsShift: true },
  { href: "/inventory", label: "المخزون", icon: "box", group: "الكافيه والمبيعات", roles: ["admin", "manager"] },
  { href: "/qr-codes", label: "أكواد QR", icon: "qr", group: "الكافيه والمبيعات" },
  { href: "/customers", label: "العملاء", icon: "users", group: "الإدارة" },
  { href: "/subscription-packages", label: "الباقات", icon: "ticket", group: "الإدارة" },
  { href: "/bank", label: "البنك", icon: "bank", group: "الإدارة", needsShift: true },
  { href: "/expenses", label: "المصاريف والإيرادات", icon: "wallet", group: "الإدارة", needsShift: true },
  { href: "/reports", label: "التقارير", icon: "chart", group: "الإدارة", roles: ["admin", "manager"] },
  { href: "/admin", label: "لوحة المالك", icon: "shield", group: "الإدارة", roles: ["admin"], ownerOnly: true },
  { href: "/settings", label: "الإعدادات", icon: "sliders", group: "الإدارة" },
];

const GROUPS: Group[] = ["التشغيل", "الكافيه والمبيعات", "الإدارة"];

export default function Sidebar({
  role,
  isOwner = false,
  hasShift,
  workspaceName,
  pendingOrders = 0,
  activeShift,
  open = false,
  onClose,
  lang = "ar",
}: {
  lang?: Lang;
  role: Role;
  isOwner?: boolean;
  hasShift: boolean;
  workspaceName: string;
  pendingOrders?: number;
  activeShift: { id: number; openedAt: string } | null;
  open?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const items = NAV.filter((item) => (!item.roles || item.roles.includes(role)) && (!item.ownerOnly || isOwner));
  const initials = (workspaceName || "WS").trim().slice(0, 2).toUpperCase();

  return (
    <>
      <button
        type="button"
        aria-label={tr(lang, "إغلاق القائمة")}
        onClick={onClose}
        className={`x-side-backdrop ${open ? "open" : ""}`}
        tabIndex={open ? 0 : -1}
      />

      <aside id="app-sidebar" className={`x-side ${open ? "open" : ""}`} aria-label={tr(lang, "قائمة التنقل")}>
        <div className="x-brand x-brand-logo-wrap">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="x-brand-logo" src="/scope-logo-brand.jpg" alt={workspaceName || "Scope Space"} width={909} height={486} />
          <div className="x-brand-sub">{tr(lang, "لوحة التحكم")}</div>
        </div>

        <nav className="x-nav" aria-label={tr(lang, "التنقل الرئيسي")}>
          {GROUPS.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (!groupItems.length) return null;
            return (
              <section key={group} aria-label={tr(lang, group)}>
                <div className="x-nav-label">{tr(lang, group)}</div>
                {groupItems.map((item) => {
                  const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const disabled = Boolean(item.needsShift && !hasShift);
                  const href = disabled ? "/shift" : item.href;
                  return (
                    <Link
                      key={item.href}
                      href={href}
                      onClick={onClose}
                      aria-current={isActive ? "page" : undefined}
                      title={disabled ? tr(lang, "افتح شيفت الأول") : tr(lang, item.label)}
                      className={`${isActive ? "active" : ""} ${disabled ? "locked" : ""}`}
                    >
                      <Icon name={item.icon} size={18} />
                      <span className="flex-1">{tr(lang, item.label)}</span>
                      {item.href === "/orders" && pendingOrders > 0 ? (
                        <span className="x-count" style={{ background: "#dc2626", color: "#fff", minWidth: 22, height: 22, fontSize: 12 }}>{pendingOrders}</span>
                      ) : null}
                      {disabled ? (
                        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-label={tr(lang, "يحتاج شيفت مفتوح")}><rect x="3.5" y="7" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
                      ) : null}
                    </Link>
                  );
                })}
              </section>
            );
          })}
        </nav>

        <div className={`x-shift-card ${activeShift ? "" : "idle"}`}>
          <b>
            <span className="x-dot" style={activeShift ? undefined : { background: "#94a3b8", boxShadow: "none" }} />
            {activeShift ? tr(lang, "الشيفت مفتوح") : tr(lang, "مفيش شيفت مفتوح")}
          </b>
          <small>
            {activeShift
              ? (lang === "en" ? `Shift #${activeShift.id}` : `شيفت رقم ${activeShift.id}`)
              : tr(lang, "افتح شيفت عشان تبدأ الشغل")}
          </small>
        </div>
      </aside>
    </>
  );
}
