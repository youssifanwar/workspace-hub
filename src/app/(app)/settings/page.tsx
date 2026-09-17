import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";

import { db } from "@/db";
import {
  desks,
  meetingRoomPricing,
  users,
} from "@/db/schema";

import {
  canManage,
  getCurrentUser,
  isAdmin,
} from "@/lib/auth";

import {
  getAllSettings,
  getCustomerSessionPricing,
} from "@/lib/settings";

import { detectLocalIp } from "@/lib/network";

import AccountSettings from "./AccountSettings";
import WorkspaceSettings from "./WorkspaceSettings";
import UsersAdmin from "./UsersAdmin";
import DesksAdmin from "./DesksAdmin";
import MeetingRoomPackagesAdmin from "./MeetingRoomPackagesAdmin";
import CustomerSessionPricingAdmin from "./CustomerSessionPricingAdmin";
import PrintingSettings from "./PrintingSettings";
import QrUrlSettings from "./QrUrlSettings";
import GoogleCalendarSettings from "./GoogleCalendarSettings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const settings = await getAllSettings();

  const isMgr = canManage(user.role);
  const admin = isAdmin(user.role);

  const [
    customerSessionPricing,
    allUsers,
    allDesks,
    meetingRoomPricingRows,
  ] = await Promise.all([
    isMgr
      ? getCustomerSessionPricing()
      : Promise.resolve(null),

    admin
      ? db
          .select({
            id: users.id,
            username: users.username,
            fullName: users.fullName,
            role: users.role,
            active: users.active,
          })
          .from(users)
          .orderBy(asc(users.id))
      : Promise.resolve([]),

    isMgr
      ? db
          .select({
            id: desks.id,
            name: desks.name,
            type: desks.type,
            hourlyRate: desks.hourlyRate,
            capacity: desks.capacity,
            active: desks.active,
            sortOrder: desks.sortOrder,
          })
          .from(desks)
          .orderBy(
            asc(desks.type),
            asc(desks.sortOrder),
            asc(desks.id),
          )
      : Promise.resolve([]),

    isMgr
      ? db
          .select({
            id: meetingRoomPricing.id,
            deskId: meetingRoomPricing.deskId,
            minPeople: meetingRoomPricing.minPeople,
            maxPeople: meetingRoomPricing.maxPeople,
            hourlyRate: meetingRoomPricing.hourlyRate,
            active: meetingRoomPricing.active,
          })
          .from(meetingRoomPricing)
          .orderBy(
            asc(meetingRoomPricing.deskId),
            asc(meetingRoomPricing.minPeople),
            asc(meetingRoomPricing.maxPeople),
          )
      : Promise.resolve([]),
  ]);

  const desksForAdmin = allDesks.map((desk) => {
    const pricingTiers =
      desk.type === "meeting_room"
        ? meetingRoomPricingRows
            .filter((tier) => tier.deskId === desk.id)
            .map((tier) => ({
              id: tier.id,
              minPeople: tier.minPeople,
              maxPeople: tier.maxPeople,
              hourlyRate: tier.hourlyRate,
              active: tier.active,
            }))
        : [];

    return {
      id: desk.id,
      name: desk.name,
      type: desk.type,
      hourlyRate: desk.hourlyRate,
      capacity: desk.capacity,
      active: desk.active,
      sortOrder: desk.sortOrder,
      pricingTiers,
    };
  });

  const detectedIp = isMgr
    ? detectLocalIp()
    : null;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* HEADER */}
      <div>
        <h1 className="text-3xl font-bold text-slate-900">
          Settings
        </h1>

        <p className="text-slate-500">
          Configure your account, workspace, staff, rooms,
          pricing and integrations.
        </p>
      </div>

      {/* ACCOUNT + WORKSPACE */}
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <h3 className="font-bold mb-4">
            👤 My account
          </h3>

          <AccountSettings
            username={user.username}
            fullName={user.fullName}
          />
        </div>

        {isMgr && (
          <div className="card p-6">
            <h3 className="font-bold mb-4">
              🏢 Workspace
            </h3>

            <WorkspaceSettings
              workspaceName={settings.workspace_name}
              workspaceAddress={settings.workspace_address}
              workspacePhone={settings.workspace_phone}
              currency={settings.currency}
              invoiceFooter={settings.invoice_footer}
            />
          </div>
        )}
      </div>

      {/* CUSTOMER SESSION PRICING */}
      {isMgr && customerSessionPricing && (
        <div className="card p-6">
          <CustomerSessionPricingAdmin
            currency={settings.currency}
            initialPricing={customerSessionPricing}
          />
        </div>
      )}

      {/* GOOGLE CALENDAR */}
      {isMgr && (
        <div className="card p-6">
          <div className="mb-4">
            <h3 className="font-bold">
              📅 Google Calendar
            </h3>

            <p className="text-sm text-slate-500 mt-1">
              Connect the workspace Google account to manage
              meeting-room availability and reservations.
            </p>
          </div>

          <GoogleCalendarSettings />
        </div>
      )}

      {/* PRINTING + QR */}
      {isMgr && (
        <div className="card p-6">
          <h3 className="font-bold mb-4">
            🖨️ Printing & QR ordering
          </h3>

          <PrintingSettings
            autoPrint={settings.auto_print_orders === "1"}
            kitchenPrinter={settings.kitchen_printer_name}
            invoicePrinter={settings.invoice_printer_name}
          />
        </div>
      )}

      {/* PUBLIC URL */}
      {isMgr && (
        <div className="card p-6">
          <h3 className="font-bold mb-4">
            📡 Public URL for QR menu
          </h3>

          <QrUrlSettings
            configured={settings.public_base_url}
            detected={detectedIp || "unavailable"}
          />
        </div>
      )}

      {/* LOCATIONS + MEETING ROOMS */}
      {isMgr && (
        <div className="card p-6">
          <div className="mb-5">
            <h3 className="font-bold">
              🪑 Locations & Meeting Rooms
            </h3>

            <p className="text-sm text-slate-500 mt-1">
              Manage physical locations, meeting-room capacity
              and meeting-room pricing tiers. Inactive locations
              remain visible so they can be reactivated.
            </p>
          </div>

          <DesksAdmin
            desks={desksForAdmin}
            currency={settings.currency}
          />
        </div>
      )}

      {/* MEETING ROOM PACKAGES */}
      {isMgr && (
        <div className="card p-6">
          <MeetingRoomPackagesAdmin
            currency={settings.currency}
          />
        </div>
      )}

      {/* USERS */}
      {admin && (
        <div className="card p-6">
          <h3 className="font-bold mb-4">
            👥 Users & permissions
          </h3>

          <UsersAdmin
            users={allUsers.map((userRow) => ({
              id: userRow.id,
              username: userRow.username,
              fullName: userRow.fullName,
              role: userRow.role,
              active: userRow.active,
            }))}
          />
        </div>
      )}
    </div>
  );
}