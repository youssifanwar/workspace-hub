"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/auth";

type NavItem = {
  href: string;
  label: string;
  icon: string;
  roles?: Role[];
  needsShift?: boolean;
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "📊" },
  { href: "/shift", label: "My Shift", icon: "🕐" },
  { href: "/bookings", label: "Bookings", icon: "🪑", needsShift: true },
  { href: "/meeting-rooms", label: "Meeting Rooms", icon: "👥", needsShift: true },
  { href: "/orders", label: "Live Orders", icon: "🔔" },
  { href: "/menu", label: "Menu (F&B)", icon: "🍔" },
  { href: "/qr-codes", label: "QR Codes", icon: "🔳" },
  { href: "/customers", label: "Customers", icon: "👤" },
  { href: "/bank", label: "Bank", icon: "🏦", needsShift: true },
  { href: "/expenses", label: "Expenses", icon: "💸", needsShift: true },
  {
    href: "/reports",
    label: "Reports",
    icon: "📈",
    roles: ["admin", "manager"],
  },
  { href: "/settings", label: "Settings", icon: "⚙️" },
];

export default function Sidebar({
  role,
  hasShift,
  workspaceName,
}: {
  role: Role;
  hasShift: boolean;
  workspaceName: string;
}) {
  const pathname = usePathname();
  const items = NAV.filter((n) => !n.roles || n.roles.includes(role));

  return (
    <aside className="w-64 shrink-0 bg-[#0b1020] text-white flex flex-col sticky top-0 h-screen">
      <div className="px-5 pt-6 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-cyan-400 grid place-items-center text-lg font-bold shadow-lg">
            🏢
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold truncate">{workspaceName}</div>
            <div className="text-[11px] text-slate-400">Management System</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto scroll-fade">
        {items.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const disabled = item.needsShift && !hasShift;
          return (
            <Link
              key={item.href}
              href={disabled ? "/shift" : item.href}
              className={`sidebar-link ${active ? "active" : ""} ${
                disabled ? "opacity-50" : ""
              }`}
              title={disabled ? "Open a shift first" : item.label}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="flex-1">{item.label}</span>
              {disabled && <span className="text-xs">🔒</span>}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-white/10 text-[11px] text-slate-400">
        <div>Role: <span className="text-slate-200 font-semibold">{role}</span></div>
        <div className="mt-1">v1.0 · WorkSpace Hub</div>
      </div>
    </aside>
  );
}
