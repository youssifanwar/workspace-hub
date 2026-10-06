import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { bookings, shifts, users } from "@/db/schema";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { formatMoney, getSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

function formatDateTime(value: Date | null): string {
  if (!value) return "-";
  return value.toLocaleString("en-EG", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(from: Date, to: Date | null): string {
  const ms = (to ?? new Date()).getTime() - from.getTime();
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}

export default async function StaffShiftsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!isAdmin(user.role)) redirect("/settings");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [currency, allUsers, openShiftRows, todayShiftRows, todayCheckinRows] =
    await Promise.all([
      getSetting("currency"),

      // Every account on the system.
      db
        .select({
          id: users.id,
          fullName: users.fullName,
          username: users.username,
          role: users.role,
          active: users.active,
        })
        .from(users)
        .orderBy(users.fullName),

      // Currently open shift(s) — should never be more than one, but the
      // query doesn't assume that so a bug would be visible here too.
      db
        .select({
          id: shifts.id,
          userId: shifts.userId,
          openedAt: shifts.openedAt,
          openingCash: shifts.openingCash,
        })
        .from(shifts)
        .where(isNull(shifts.closedAt))
        .orderBy(desc(shifts.openedAt)),

      // Every shift (open or closed) opened today, oldest first.
      db
        .select({
          id: shifts.id,
          userId: shifts.userId,
          openedAt: shifts.openedAt,
          closedAt: shifts.closedAt,
          openingCash: shifts.openingCash,
          closingCash: shifts.closingCash,
        })
        .from(shifts)
        .where(gte(shifts.openedAt, startOfDay))
        .orderBy(shifts.openedAt),

      // How many customer sessions each staff member checked in today
      // (open-seating sessions only — deskId null — same rule used
      // elsewhere to keep this separate from meeting-room check-ins).
      db
        .select({
          userId: bookings.userId,
          count: sql<number>`count(*)::int`,
        })
        .from(bookings)
        .where(
          and(
            gte(bookings.checkedInAt, startOfDay),
            isNull(bookings.deskId),
          ),
        )
        .groupBy(bookings.userId),
    ]);

  const checkinsByUser = new Map<number, number>();
  for (const row of todayCheckinRows) {
    if (row.userId !== null) {
      checkinsByUser.set(row.userId, row.count);
    }
  }

  const openShiftByUser = new Map<number, (typeof openShiftRows)[number]>();
  for (const row of openShiftRows) {
    openShiftByUser.set(row.userId, row);
  }

  const usersById = new Map(allUsers.map((u) => [u.id, u]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Staff &amp; Shifts
          </h1>
          <p className="text-slate-500">
            Who has the register open right now, and today&apos;s activity
            per staff member. Only one shift can be open system-wide at a
            time.
          </p>
        </div>
        <Link href="/settings" className="btn btn-ghost">
          ← Back to Settings
        </Link>
      </div>

      {/* CURRENTLY OPEN */}
      <section className="card p-5">
        <h2 className="font-bold mb-3">Currently open</h2>
        {openShiftRows.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-6">
            No shift is open right now.
          </div>
        ) : (
          <div className="space-y-2">
            {openShiftRows.map((row) => {
              const owner = usersById.get(row.userId);
              return (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4"
                >
                  <div>
                    <div className="font-bold text-emerald-900">
                      {owner?.fullName ?? `User #${row.userId}`}
                      <span className="ml-2 text-xs font-normal text-emerald-700">
                        {owner?.role}
                      </span>
                    </div>
                    <div className="text-sm text-emerald-700">
                      Opened {formatDateTime(row.openedAt)} · open for{" "}
                      {formatDuration(row.openedAt, null)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-emerald-700">
                      Opening cash
                    </div>
                    <div className="font-bold text-emerald-900 tabular-nums">
                      {formatMoney(row.openingCash, currency)}
                    </div>
                  </div>
                </div>
              );
            })}
            {openShiftRows.length > 1 && (
              <div className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">
                ⚠️ More than one shift is open at the same time. This should
                not normally happen — close the extra shift(s) from the
                Shift page.
              </div>
            )}
          </div>
        )}
      </section>

      {/* TODAY'S SHIFTS */}
      <section className="card p-5">
        <h2 className="font-bold mb-3">Today&apos;s shifts</h2>
        {todayShiftRows.length === 0 ? (
          <div className="text-sm text-slate-400 text-center py-6">
            No shift opened today yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-2 pr-4">Staff</th>
                  <th className="py-2 pr-4">Opened</th>
                  <th className="py-2 pr-4">Closed</th>
                  <th className="py-2 pr-4">Duration</th>
                  <th className="py-2 pr-4 text-right">Opening cash</th>
                  <th className="py-2 pr-4 text-right">Closing cash</th>
                  <th className="py-2 pr-4 text-right">
                    Sessions registered
                  </th>
                </tr>
              </thead>
              <tbody className="divide-soft">
                {todayShiftRows.map((row) => {
                  const owner = usersById.get(row.userId);
                  return (
                    <tr key={row.id}>
                      <td className="py-2 pr-4 font-semibold">
                        {owner?.fullName ?? `User #${row.userId}`}
                      </td>
                      <td className="py-2 pr-4">
                        {formatDateTime(row.openedAt)}
                      </td>
                      <td className="py-2 pr-4">
                        {row.closedAt ? (
                          formatDateTime(row.closedAt)
                        ) : (
                          <span className="badge badge-green">Open</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">
                        {formatDuration(row.openedAt, row.closedAt)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {formatMoney(row.openingCash, currency)}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {row.closingCash
                          ? formatMoney(row.closingCash, currency)
                          : "-"}
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums">
                        {checkinsByUser.get(row.userId) ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ALL ACCOUNTS */}
      <section className="card p-5">
        <h2 className="font-bold mb-3">All accounts</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Username</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Shift</th>
                <th className="py-2 pr-4 text-right">
                  Checked in today
                </th>
              </tr>
            </thead>
            <tbody className="divide-soft">
              {allUsers.map((u) => {
                const open = openShiftByUser.get(u.id);
                return (
                  <tr key={u.id}>
                    <td className="py-2 pr-4 font-semibold">{u.fullName}</td>
                    <td className="py-2 pr-4 text-slate-500">
                      {u.username}
                    </td>
                    <td className="py-2 pr-4">{u.role}</td>
                    <td className="py-2 pr-4">
                      {u.active ? (
                        <span className="badge badge-green">Active</span>
                      ) : (
                        <span className="badge badge-red">Disabled</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {open ? (
                        <span className="text-emerald-700 font-semibold">
                          Open since {formatDateTime(open.openedAt)}
                        </span>
                      ) : (
                        <span className="text-slate-400">Closed</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {checkinsByUser.get(u.id) ?? 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
