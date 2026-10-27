"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import type { Role } from "@/lib/auth";

import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import PageMotion from "./PageMotion";

type SessionUserProp = React.ComponentProps<typeof Topbar>["user"];

/**
 * Responsive application frame: the sidebar is always visible on large
 * screens and becomes a slide-in drawer (opened from the top bar) on
 * tablets and phones.
 */
export default function AppShell({
  role,
  hasShift,
  workspaceName,
  user,
  activeShift,
  children,
}: {
  role: Role;
  hasShift: boolean;
  workspaceName: string;
  user: SessionUserProp;
  activeShift: { id: number; openedAt: string } | null;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer after navigating.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Esc closes it; lock page scroll while it is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <div className="app-frame min-h-screen flex">
      <Sidebar
        role={role}
        hasShift={hasShift}
        workspaceName={workspaceName}
        open={open}
        onClose={() => setOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          user={user}
          activeShift={activeShift}
          menuOpen={open}
          onMenuClick={() => setOpen((v) => !v)}
        />

        <main className="app-main flex-1 min-w-0 p-4 sm:p-6 xl:p-8">
          <PageMotion>{children}</PageMotion>
        </main>
      </div>
    </div>
  );
}
