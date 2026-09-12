import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { getCurrentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function toExcelDate(value: unknown): string {
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString("en-GB");
}

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    /*
     * One row per customer.
     *
     * The active subscription is the most recently purchased active
     * subscription. Remaining package hours come from the ledger:
     * SUM(hours_delta).
     */
    const result = await db.execute(sql`
      SELECT
        c.id,
        c.name,
        c.phone,
        c.email,
        c.notes,
        c.created_at,

        COUNT(DISTINCT b.id)::int AS total_visits,

        COALESCE(
          SUM(DISTINCT b.total),
          0
        )::numeric AS total_spent,

        MAX(b.checked_in_at) AS last_visit,

        active_sub.id AS subscription_id,
        active_sub.package_name AS package_name,
        active_sub.total_hours AS package_total_hours,
        active_sub.price AS package_price,
        active_sub.validity_days AS package_validity_days,
        active_sub.purchased_at AS package_purchased_at,
        active_sub.starts_at AS package_starts_at,
        active_sub.expires_at AS package_expires_at,
        active_sub.status AS package_status,

        COALESCE(active_balance.remaining_hours, 0)::numeric
          AS package_remaining_hours

      FROM customers c

      LEFT JOIN bookings b
        ON b.customer_id = c.id

      LEFT JOIN LATERAL (
        SELECT
          cs.id,
          cs.package_name_snapshot AS package_name,
          cs.total_hours_snapshot AS total_hours,
          cs.price_snapshot AS price,
          cs.validity_days_snapshot AS validity_days,
          cs.purchased_at,
          cs.starts_at,
          cs.expires_at,
          cs.status
        FROM customer_subscriptions cs
        WHERE
          cs.customer_id = c.id
          AND cs.status = 'active'
        ORDER BY cs.purchased_at DESC
        LIMIT 1
      ) active_sub
        ON TRUE

      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(sul.hours_delta), 0) AS remaining_hours
        FROM subscription_usage_ledger sul
        WHERE sul.subscription_id = active_sub.id
      ) active_balance
        ON TRUE

      GROUP BY
        c.id,
        c.name,
        c.phone,
        c.email,
        c.notes,
        c.created_at,

        active_sub.id,
        active_sub.package_name,
        active_sub.total_hours,
        active_sub.price,
        active_sub.validity_days,
        active_sub.purchased_at,
        active_sub.starts_at,
        active_sub.expires_at,
        active_sub.status,

        active_balance.remaining_hours

      ORDER BY c.created_at DESC
    `);

    const rows = result.rows as Record<string, unknown>[];
    const exportRows = rows.map((row) => ({
      "Customer ID": toNumber(row.id),
      Name: String(row.name ?? ""),
      Phone: String(row.phone ?? ""),
      Email: String(row.email ?? ""),
      Notes: String(row.notes ?? ""),

      "Created At": toExcelDate(row.created_at),
      Visits: toNumber(row.total_visits),
      "Total Spent": toNumber(row.total_spent),
      "Last Visit": toExcelDate(row.last_visit),

      "Active Package": String(row.package_name ?? ""),
      "Package Total Hours": toNumber(row.package_total_hours),
      "Package Price": toNumber(row.package_price),
      "Package Validity Days": row.package_validity_days == null
        ? ""
        : toNumber(row.package_validity_days),

      "Package Purchased At": toExcelDate(row.package_purchased_at),
      "Package Starts At": toExcelDate(row.package_starts_at),
      "Package Expires At": toExcelDate(row.package_expires_at),
      "Package Remaining Hours": toNumber(row.package_remaining_hours),
      "Package Status": String(row.package_status ?? ""),
    }));

    const workbook = XLSX.utils.book_new();

    const worksheet = XLSX.utils.json_to_sheet(exportRows);

    worksheet["!cols"] = [
      { wch: 12 }, // ID
      { wch: 24 }, // Name
      { wch: 18 }, // Phone
      { wch: 30 }, // Email
      { wch: 35 }, // Notes
      { wch: 20 }, // Created
      { wch: 10 }, // Visits
      { wch: 16 }, // Spent
      { wch: 20 }, // Last visit
      { wch: 24 }, // Package
      { wch: 20 }, // Package hours
      { wch: 16 }, // Package price
      { wch: 22 }, // Validity
      { wch: 22 }, // Purchased
      { wch: 22 }, // Starts
      { wch: 22 }, // Expires
      { wch: 24 }, // Remaining
      { wch: 16 }, // Status
    ];

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Customers",
    );

    const buffer = XLSX.write(workbook, {
      type: "buffer",
      bookType: "xlsx",
    });

    const filename = `WorkspaceHub-Customers-${new Date()
      .toISOString()
      .slice(0, 10)}.xlsx`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Customer Excel export failed:", error);

    return NextResponse.json(
      {
        error: "Could not export customers.",
      },
      {
        status: 500,
      },
    );
  }
}