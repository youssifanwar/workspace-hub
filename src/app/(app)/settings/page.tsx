import {
  getCurrentUser,
  canManage,
  isAdmin,
} from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users, desks } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { getAllSettings } from "@/lib/settings";

import AccountSettings from "./AccountSettings";
import WorkspaceSettings from "./WorkspaceSettings";
import UsersAdmin from "./UsersAdmin";
import DesksAdmin from "./DesksAdmin";
import PrintingSettings from "./PrintingSettings";
import QrUrlSettings from "./QrUrlSettings";
import GoogleCalendarSettings from "./GoogleCalendarSettings";

import { detectLocalIp } from "@/lib/network";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const settings =
    await getAllSettings();

  const isMgr =
    canManage(user.role);

  const admin =
    isAdmin(user.role);

  const allUsers = admin
    ? await db
        .select()
        .from(users)
        .orderBy(
          asc(users.id),
        )
    : [];

  const allDesks = isMgr
    ? await db
        .select()
        .from(desks)
        .where(
          eq(
            desks.active,
            true,
          ),
        )
        .orderBy(
          asc(desks.type),
          asc(desks.sortOrder),
        )
    : [];

  return (
    <div className="space-y-6 max-w-5xl">

      {/* ------------------------------------------------------------------ */}
      {/* HEADER                                                             */}
      {/* ------------------------------------------------------------------ */}

      <div>
        <h1 className="text-3xl font-bold text-slate-900">
          Settings
        </h1>

        <p className="text-slate-500">
          Configure your account,
          workspace, staff, and
          integrations.
        </p>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* ACCOUNT + WORKSPACE                                                */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid lg:grid-cols-2 gap-6">

        <div className="card p-6">
          <h3 className="font-bold mb-4">
            👤 My account
          </h3>

          <AccountSettings
            username={
              user.username
            }
            fullName={
              user.fullName
            }
          />
        </div>

        {isMgr && (
          <div className="card p-6">
            <h3 className="font-bold mb-4">
              🏢 Workspace
            </h3>

            <WorkspaceSettings
              workspaceName={
                settings.workspace_name
              }
              workspaceAddress={
                settings.workspace_address
              }
              workspacePhone={
                settings.workspace_phone
              }
              currency={
                settings.currency
              }
              invoiceFooter={
                settings.invoice_footer
              }
            />
          </div>
        )}

      </div>

      {/* ------------------------------------------------------------------ */}
      {/* GOOGLE CALENDAR                                                    */}
      {/* ------------------------------------------------------------------ */}

      {isMgr && (
        <div className="card p-6">

          <div className="mb-4">
            <h3 className="font-bold">
              📅 Google Calendar
            </h3>

            <p className="text-sm text-slate-500 mt-1">
              Connect the workspace
              Google account to manage
              meeting-room availability
              and reservations.
            </p>
          </div>

          <GoogleCalendarSettings />

        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* PRINTING + QR                                                       */}
      {/* ------------------------------------------------------------------ */}

      {isMgr && (
        <div className="card p-6">

          <h3 className="font-bold mb-4">
            🖨️ Printing & QR ordering
          </h3>

          <PrintingSettings
            autoPrint={
              settings.auto_print_orders ===
              "1"
            }
            kitchenPrinter={
              settings.kitchen_printer_name
            }
            invoicePrinter={
              settings.invoice_printer_name
            }
          />

        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* PUBLIC URL                                                          */}
      {/* ------------------------------------------------------------------ */}

      {isMgr && (
        <div className="card p-6">

          <h3 className="font-bold mb-4">
            📡 Public URL for QR menu
          </h3>

          <QrUrlSettings
            configured={
              settings.public_base_url
            }
            detected={
              detectLocalIp() ||
              "unavailable"
            }
          />

        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* DESKS + MEETING ROOMS                                               */}
      {/* ------------------------------------------------------------------ */}

      {isMgr && (
        <div className="card p-6">

          <h3 className="font-bold mb-4">
            🪑 Desks & meeting rooms
          </h3>

          <DesksAdmin
            desks={allDesks.map(
              (desk) => ({
                id: desk.id,
                name: desk.name,
                type: desk.type,
                hourlyRate:
                  desk.hourlyRate,
              }),
            )}
            currency={
              settings.currency
            }
          />

        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* USERS                                                               */}
      {/* ------------------------------------------------------------------ */}

      {admin && (
        <div className="card p-6">

          <h3 className="font-bold mb-4">
            👥 Users & permissions
          </h3>

          <UsersAdmin
            users={allUsers.map(
              (userRow) => ({
                id: userRow.id,
                username:
                  userRow.username,
                fullName:
                  userRow.fullName,
                role:
                  userRow.role,
                active:
                  userRow.active,
              }),
            )}
          />

        </div>
      )}

    </div>
  );
}