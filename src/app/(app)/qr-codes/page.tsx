import { db } from "@/db";
import { desks } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getPublicBaseUrl, detectLocalIp } from "@/lib/network";
import { getSetting } from "@/lib/settings";
import QrGrid from "./QrGrid";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function QrCodesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const all = await db
    .select()
    .from(desks)
    .where(eq(desks.active, true))
    .orderBy(asc(desks.type), asc(desks.sortOrder));

  const base = await getPublicBaseUrl();
  const localIp = detectLocalIp();
  const workspaceName = await getSetting("workspace_name");
  const publicBaseConfigured = await getSetting("public_base_url");

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">QR Codes</h1>
          <p className="text-slate-500">
            Each desk has a unique QR that opens the mobile ordering menu.
          </p>
        </div>
        <Link href="/settings" className="btn btn-ghost">
          ⚙️ Change base URL
        </Link>
      </div>

      <div className="card p-5">
        <div className="text-xs uppercase font-semibold text-slate-500">
          Public order URL
        </div>
        <div className="mt-1 font-mono text-sm bg-slate-50 px-3 py-2 rounded-xl border border-slate-200 break-all">
          {base}/order/&lt;desk-id&gt;
        </div>
        <p className="text-xs text-slate-500 mt-2">
          {publicBaseConfigured ? (
            <>Base URL is set from Settings.</>
          ) : localIp ? (
            <>
              Auto-detected local IP: <b>{localIp}</b>. Make sure customer
              phones are connected to the same Wi-Fi. Set a custom URL from{" "}
              <Link href="/settings" className="text-indigo-600 underline">
                Settings
              </Link>{" "}
              if you use a fixed hostname or public tunnel.
            </>
          ) : (
            <>
              Could not detect a LAN IP. Configure a base URL in Settings.
            </>
          )}
        </p>
      </div>

      <QrGrid
        desks={all.map((d) => ({
          id: d.id,
          name: d.name,
          type: d.type,
        }))}
        baseUrl={base}
        workspaceName={workspaceName}
      />
    </div>
  );
}
