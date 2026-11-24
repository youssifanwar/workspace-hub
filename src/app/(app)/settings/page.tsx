import { PageBar } from "../_components/ui";
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
import BusinessRulesSettings from "./BusinessRulesSettings";
import WorkspaceSettings from "./WorkspaceSettings";
import UsersAdmin from "./UsersAdmin";
import DesksAdmin from "./DesksAdmin";
import MeetingRoomPackagesAdmin from "./MeetingRoomPackagesAdmin";
import CustomerSessionPricingAdmin from "./CustomerSessionPricingAdmin";
import PrintingSettings from "./PrintingSettings";
import QrUrlSettings from "./QrUrlSettings";
import GoogleCalendarSettings from "./GoogleCalendarSettings";
import { getLang } from "@/lib/i18n";
import { makeFmt } from "@/lib/i18n-shared";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const f = makeFmt(await getLang());
  const tx = f.t;
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

  type Section = { id: string; title: string; desc?: string; bare?: boolean; body: React.ReactNode };
  const sections: Section[] = [
    {
      id: "account",
      title: tx("👤 My account"),
      body: <AccountSettings username={user.username} fullName={user.fullName} />,
    },
  ];
  if (isMgr) {
    sections.push({
      id: "rules",
      title: tx("⚙️ Business rules and look"),
      body: (
        <BusinessRulesSettings
          qrMaxPending={settings.qr_max_pending_orders}
          packageMaxHours={settings.package_max_hours_per_session}
          staffMaxDiscount={settings.staff_max_discount_percent}
          brandColor={settings.brand_color}
        />
      ),
    });
    sections.push({
      id: "workspace",
      title: tx("🏢 Workspace"),
      body: (
        <WorkspaceSettings
          workspaceName={settings.workspace_name}
          workspaceAddress={settings.workspace_address}
          workspacePhone={settings.workspace_phone}
          currency={settings.currency}
          invoiceFooter={settings.invoice_footer}
          earlyCheckinMinutes={settings.meeting_room_early_checkin_minutes}
          staleSessionHours={settings.stale_session_hours}
          calendarStartHour={settings.calendar_start_hour}
          calendarEndHour={settings.calendar_end_hour}
          maxBookingHours={settings.meeting_room_max_booking_hours}
          timezone={settings.timezone}
          weekStartsOn={settings.calendar_week_starts_on}
        />
      ),
    });
    if (customerSessionPricing) {
      sections.push({
        id: "pricing",
        bare: true,
        title: tx("💳 Customer session pricing"),
        body: (
          <CustomerSessionPricingAdmin
            currency={settings.currency}
            initialPricing={customerSessionPricing}
          />
        ),
      });
    }
    sections.push(
      {
        id: "calendar",
        title: tx("📅 Google Calendar"),
        desc: tx("Connect the workspace Google account to manage meeting-room availability and reservations."),
        body: <GoogleCalendarSettings />,
      },
      {
        id: "printing",
        title: tx("🖨️ Printing & QR ordering"),
        body: (
          <PrintingSettings
            autoPrint={settings.auto_print_orders === "1"}
            kitchenPrinter={settings.kitchen_printer_name}
            invoicePrinter={settings.invoice_printer_name}
          />
        ),
      },
      {
        id: "qr-url",
        title: tx("📡 Public URL for QR menu"),
        body: (
          <QrUrlSettings
            configured={settings.public_base_url}
            detected={detectedIp || "unavailable"}
          />
        ),
      },
      {
        id: "locations",
        title: tx("🪑 Locations & Meeting Rooms"),
        desc: tx("Manage physical locations, meeting-room capacity and meeting-room pricing tiers. Inactive locations remain visible so they can be reactivated."),
        body: <DesksAdmin desks={desksForAdmin} currency={settings.currency} />,
      },
      {
        id: "packages",
        bare: true,
        title: tx("🎟️ Meeting Room Packages"),
        body: <MeetingRoomPackagesAdmin currency={settings.currency} />,
      },
    );
  }
  if (admin) {
    sections.push({
      id: "users",
      title: tx("👥 Users & permissions"),
      body: (
        <>
          <div style={{ marginBottom: 14 }}>
            <a href="/settings/shifts" className="btn btn-ghost">
              {tx("🕒 Who's on shift →")}
            </a>
          </div>
          <UsersAdmin
            users={allUsers.map((userRow) => ({
              id: userRow.id,
              username: userRow.username,
              fullName: userRow.fullName,
              role: userRow.role,
              active: userRow.active,
            }))}
          />
        </>
      ),
    });
  }

  return (
    <div>
      <PageBar
        crumb={tx("Admin")}
        title={tx("Settings")}
        description={tx("Configure your account, workspace, staff, rooms, pricing and integrations.")}
      />

      <div className="v2-settings">
        <nav className="v2-settings-nav" aria-label={tx("Settings")}>
          {sections.map((sec) => (
            <a key={sec.id} href={`#${sec.id}`}>
              {sec.title}
            </a>
          ))}
        </nav>

        <div className="v2-settings-body">
          {sections.map((sec) => (
            <section key={sec.id} id={sec.id} className="v2-panel v2-section">
              {!sec.bare && (
                <div className="v2-panel-head v2-section-head">
                  <div>
                    <h2>{sec.title}</h2>
                    {sec.desc && <p>{sec.desc}</p>}
                  </div>
                </div>
              )}
              <div className="v2-panel-body">{sec.body}</div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
