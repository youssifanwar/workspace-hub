"use client";

import Icon, { type IconName } from "./Icon";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/auth";

type Group = "Workspace" | "Cafe & sales" | "Management";

type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  group: Group;
  roles?: Role[];
  needsShift?: boolean;
};

// Keep the existing route map, shift gates, and role restrictions while using
// the consistent icon system from the refreshed interface.
const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", group: "Workspace" },
  { href: "/shift", label: "My Shift", icon: "clock", group: "Workspace" },
  { href: "/bookings", label: "Bookings", icon: "calendar", group: "Workspace", needsShift: true },
  { href: "/meeting-rooms", label: "Meeting Rooms", icon: "building", group: "Workspace", needsShift: true },
  { href: "/orders", label: "Live Orders", icon: "bell", group: "Cafe & sales" },
  { href: "/menu", label: "Menu & F&B", icon: "utensils", group: "Cafe & sales" },
  { href: "/fnb", label: "Direct F&B Sale", icon: "receipt", group: "Cafe & sales", needsShift: true },
  { href: "/inventory", label: "Inventory", icon: "box", group: "Cafe & sales", roles: ["admin", "manager"] },
  { href: "/qr-codes", label: "QR Codes", icon: "qr", group: "Cafe & sales" },
  { href: "/customers", label: "Customers", icon: "users", group: "Management" },
  { href: "/subscription-packages", label: "Subscriptions", icon: "ticket", group: "Management" },
  { href: "/bank", label: "Bank", icon: "bank", group: "Management", needsShift: true },
  { href: "/expenses", label: "Expenses & Income", icon: "wallet", group: "Management", needsShift: true },
  { href: "/reports", label: "Reports & insights", icon: "chart", group: "Management", roles: ["admin", "manager"] },
  { href: "/settings", label: "Settings", icon: "sliders", group: "Management" },
];

const GROUPS: Group[] = ["Workspace", "Cafe & sales", "Management"];

export default function Sidebar({
  role,
  hasShift,
  workspaceName,
  open = false,
  onClose,
}: {
  role: Role;
  hasShift: boolean;
  workspaceName: string;
  open?: boolean;
  onClose?: () => void;
}) {
  const pathname = usePathname();
  const items = NAV.filter((item) => !item.roles || item.roles.includes(role));

  return (
    <>
      <button
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
        className={`sidebar-backdrop lg:hidden ${open ? "is-open" : ""}`}
        tabIndex={open ? 0 : -1}
      />

      <aside
        id="app-sidebar"
        className={`app-sidebar fixed inset-y-0 left-0 z-50 flex h-screen w-[278px] shrink-0 flex-col transition-transform duration-300 lg:sticky lg:top-0 lg:z-auto lg:translate-x-0 ${open ? "translate-x-0" : "-translate-x-full"}`}
        aria-label="Workspace navigation"
      >
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 36 36" width="29" height="29" fill="none">
              <path d="M6 28V13.5L18 6l12 7.5V28H6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M12 28V18h12v10M18 18v10M6 13.5h24" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              <path d="M11 11l7 4 7-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <div className="sidebar-brand-name" title={workspaceName}>{workspaceName || "WorkSpace Hub"}</div>
            <div className="sidebar-brand-caption">WORKSPACE OPERATIONS</div>
          </div>
          <span className="brand-status-dot" title="Workspace interface" aria-label="Workspace interface" />
        </div>

        <div className="sidebar-workspace-pill">
          <span className="sidebar-workspace-glyph" aria-hidden="true">✦</span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[.15em] text-slate-400 font-semibold">Workspace</div>
            <div className="truncate text-[12px] font-semibold text-slate-100">Operations Console</div>
          </div>
        </div>

        <nav className="sidebar-navigation scroll-fade" aria-label="Main navigation">
          {GROUPS.map((group) => {
            const groupItems = items.filter((item) => item.group === group);
            if (!groupItems.length) return null;
            return (
              <section className="sidebar-group" key={group} aria-label={group}>
                <div className="sidebar-section-label">{group}</div>
                <div className="space-y-1">
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
                        aria-disabled={disabled || undefined}
                        title={disabled ? "Open a shift first" : item.label}
                        className={`sidebar-link ${isActive ? "active" : ""} ${disabled ? "is-locked" : ""}`}
                      >
                        <span className="sidebar-icon"><Icon name={item.icon} size={18} /></span>
                        <span className="sidebar-link-label">{item.label}</span>
                        {disabled ? (
                          <span className="sidebar-lock" aria-label="Requires an active shift">
                            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true"><rect x="3.5" y="7" width="9" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                          </span>
                        ) : isActive ? <span className="sidebar-active-indicator" aria-hidden="true" /> : null}
                      </Link>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-health-card">
            <span className="sidebar-health-icon" aria-hidden="true">
              <svg viewBox="0 0 20 20" width="17" height="17" fill="none"><path d="m3 10 4 4 10-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-100">One workspace</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Your tools, all in one place</div>
            </div>
            <span className="health-pulse" aria-hidden="true" />
          </div>
          <div className="sidebar-user-foot">
            <div className="sidebar-role-avatar" aria-hidden="true">{role.slice(0, 1).toUpperCase()}</div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-200 capitalize">{role}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">Access role</div>
            </div>
            <span className="text-[10px] text-slate-500">v1.1</span>
          </div>
        </div>
      </aside>
    </>
  );
}
