import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";
import { getSetting } from "@/lib/settings";
import { db } from "@/db";
import { orderTickets } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

import { getLang } from "@/lib/i18n";
import AppShell from "./_components/AppShell";
import GlobalOrderAlerts from "./GlobalOrderAlerts";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();
  const lang = await getLang();

  if (!user) {
    redirect("/login");
  }

  const [activeShift, workspaceName, pendingRows] = await Promise.all([
    getActiveShiftForUser(user.id),
    getSetting("workspace_name"),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(orderTickets)
      .where(eq(orderTickets.status, "pending")),
  ]);

  return (
    <>
      <AppShell
        role={user.role}
        hasShift={activeShift !== null}
        workspaceName={workspaceName}
        lang={lang}
        user={user}
        pendingOrders={Number(pendingRows[0]?.c ?? 0)}
        activeShift={
          activeShift
            ? {
                id: activeShift.id,
                openedAt: activeShift.openedAt.toISOString(),
              }
            : null
        }
      >
        {children}
      </AppShell>

      <GlobalOrderAlerts />
    </>
  );
}

export function NoShiftGuard({
  hasShift,
  children,
}: {
  hasShift: boolean;
  children: ReactNode;
}) {
  if (!hasShift) {
    return (
      <div className="max-w-lg mx-auto x-card p-8 text-center mt-16">
        <div className="text-5xl mb-3" aria-hidden="true">
          🔒
        </div>

        <h2 className="text-xl font-bold mb-2">مفيش شيفت مفتوح</h2>

        <p className="text-slate-500 mb-5">
          لازم تفتح شيفت الأول عشان تدخل القسم ده.
        </p>

        <Link href="/shift" className="btn btn-primary">
          افتح شيفت ←
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
