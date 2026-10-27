"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

/** A lightweight route-change entrance that respects reduced-motion preferences. */
export default function PageMotion({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div key={pathname} className="app-page-enter">{children}</div>;
}
