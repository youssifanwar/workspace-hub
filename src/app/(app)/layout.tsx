import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";
import { getSetting } from "@/lib/settings";

import AppShell from "./_components/AppShell";
import GlobalOrderAlerts from "./GlobalOrderAlerts";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const [activeShift, workspaceName] = await Promise.all([
    getActiveShiftForUser(user.id),
    getSetting("workspace_name"),
  ]);

  return (
    <>
      <AppShell
        role={user.role}
        hasShift={activeShift !== null}
        workspaceName={workspaceName}
        user={user}
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
      <div className="max-w-lg mx-auto card p-8 text-center mt-16">
        <div className="text-5xl mb-3" aria-hidden="true">
          🔒
        </div>

        <h2 className="text-xl font-bold mb-2">No active shift</h2>

        <p className="text-slate-500 mb-5">
          You need to open a shift before you can access this section.
        </p>

        <Link href="/shift" className="btn btn-primary">
          Open a shift →
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
