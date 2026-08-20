import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, canManage } from "@/lib/auth";
import { getActiveShiftForUser } from "@/lib/shift";
import { getSetting } from "@/lib/settings";
import Sidebar from "./_components/Sidebar";
import Topbar from "./_components/Topbar";
import NotificationListener from "./_components/NotificationListener";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const activeShift = await getActiveShiftForUser(user.id);
  const workspaceName = await getSetting("workspace_name");

  return (
    <div className="min-h-screen flex">
      <Sidebar
        role={user.role}
        hasShift={!!activeShift}
        workspaceName={workspaceName}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar
          user={user}
          activeShift={
            activeShift
              ? {
                  id: activeShift.id,
                  openedAt: activeShift.openedAt.toISOString(),
                }
              : null
          }
        />
        <main className="flex-1 p-6 md:p-8 overflow-y-auto">{children}</main>
      </div>
      <NotificationListener />
    </div>
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
        <div className="text-5xl mb-3">🔒</div>
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
