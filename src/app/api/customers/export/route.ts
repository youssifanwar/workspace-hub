import { NextResponse } from "next/server";

import * as XLSX from "xlsx";

import { sql } from "drizzle-orm";

import { db } from "@/db";

import { getCurrentUser } from "@/lib/auth";

export const dynamic =
  "force-dynamic";

export const runtime =
  "nodejs";

function toExcelDate(
  value: unknown,
): string {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "";
  }

  const date =
    value instanceof Date
      ? value
      : new Date(
          String(value),
        );

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return String(
      value,
    );
  }

  return date.toLocaleString(
    "en-GB",
  );
}

function toNumber(
  value: unknown,
): number {
  const n =
    Number(
      value ?? 0,
    );

  return Number.isFinite(
    n,
  )
    ? n
    : 0;
}

function toText(
  value: unknown,
): string {
  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(
    value,
  );
}

export async function GET() {
  try {
    /* ---------------------------------------------------------------------- */
    /* AUTH                                                                   */
    /* ---------------------------------------------------------------------- */

    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error:
            "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* DATA                                                                   */
    /* ---------------------------------------------------------------------- */

    /*
     * One row per customer.
     *
     * The active subscription is the most recently purchased subscription
     * that is still active and has not expired.
     *
     * Remaining package hours come from the usage ledger:
     * SUM(hours_delta).
     */
    const result =
      await db.execute(
        sql`
          SELECT
            c.id,
            c.name,
            c.phone,
            c.email,
            c.notes,
            c.created_at,

            COUNT(
              DISTINCT b.id
            )::int AS total_visits,

            COALESCE(
              SUM(
                b.total
              ),
              0
            )::numeric AS total_spent,

            MAX(
              b.checked_in_at
            ) AS last_visit,

            active_sub.id
              AS subscription_id,

            active_sub.package_name
              AS package_name,

            active_sub.total_hours
              AS package_total_hours,

            active_sub.price
              AS package_price,

            active_sub.validity_days
              AS package_validity_days,

            active_sub.purchased_at
              AS package_purchased_at,

            active_sub.starts_at
              AS package_starts_at,

            active_sub.expires_at
              AS package_expires_at,

            active_sub.status
              AS package_status,

            COALESCE(
              active_balance.remaining_hours,
              0
            )::numeric
              AS package_remaining_hours

          FROM customers c

          LEFT JOIN bookings b
            ON b.customer_id =
              c.id

          LEFT JOIN LATERAL (
            SELECT
              cs.id,

              cs.package_name_snapshot
                AS package_name,

              cs.total_hours_snapshot
                AS total_hours,

              cs.price_snapshot
                AS price,

              cs.validity_days_snapshot
                AS validity_days,

              cs.purchased_at,

              cs.starts_at,

              cs.expires_at,

              cs.status

            FROM customer_subscriptions cs

            WHERE
              cs.customer_id =
                c.id

              AND cs.status =
                'active'

              AND (
                cs.expires_at IS NULL

                OR cs.expires_at >
                  NOW()
              )

              AND cs.starts_at <=
                NOW()

            ORDER BY
              cs.purchased_at DESC

            LIMIT 1
          ) active_sub
            ON TRUE

          LEFT JOIN LATERAL (
            SELECT
              COALESCE(
                SUM(
                  sul.hours_delta
                ),
                0
              ) AS remaining_hours

            FROM subscription_usage_ledger sul

            WHERE
              sul.subscription_id =
                active_sub.id
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

          ORDER BY
            c.created_at DESC
        `,
      );

    /* ---------------------------------------------------------------------- */
    /* EXPORT ROWS                                                            */
    /* ---------------------------------------------------------------------- */

    const rows =
      result.rows as Record<
        string,
        unknown
      >[];

    const exportRows =
      rows.map(
        (
          row,
        ) => ({
          "Customer ID":
            toNumber(
              row.id,
            ),

          Name:
            toText(
              row.name,
            ),

          Phone:
            toText(
              row.phone,
            ),

          Email:
            toText(
              row.email,
            ),

          Notes:
            toText(
              row.notes,
            ),

          "Created At":
            toExcelDate(
              row.created_at,
            ),

          Visits:
            toNumber(
              row.total_visits,
            ),

          "Total Spent":
            toNumber(
              row.total_spent,
            ),

          "Last Visit":
            toExcelDate(
              row.last_visit,
            ),

          "Active Package":
            toText(
              row.package_name,
            ),

          "Package Total Hours":
            toNumber(
              row.package_total_hours,
            ),

          "Package Price":
            toNumber(
              row.package_price,
            ),

          "Package Validity Days":
            row.package_validity_days ==
              null
              ? ""
              : toNumber(
                  row.package_validity_days,
                ),

          "Package Purchased At":
            toExcelDate(
              row.package_purchased_at,
            ),

          "Package Starts At":
            toExcelDate(
              row.package_starts_at,
            ),

          "Package Expires At":
            toExcelDate(
              row.package_expires_at,
            ),

          "Package Remaining Hours":
            toNumber(
              row.package_remaining_hours,
            ),

          "Package Status":
            toText(
              row.package_status,
            ),
        }),
      );

    /* ---------------------------------------------------------------------- */
    /* WORKBOOK                                                               */
    /* ---------------------------------------------------------------------- */

    const workbook =
      XLSX.utils.book_new();

    const worksheet =
      XLSX.utils.json_to_sheet(
        exportRows,
      );

    worksheet["!cols"] = [
      { wch: 12 },
      { wch: 24 },
      { wch: 18 },
      { wch: 30 },
      { wch: 35 },
      { wch: 20 },
      { wch: 10 },
      { wch: 16 },
      { wch: 20 },
      { wch: 24 },
      { wch: 20 },
      { wch: 16 },
      { wch: 22 },
      { wch: 22 },
      { wch: 22 },
      { wch: 22 },
      { wch: 24 },
      { wch: 16 },
    ];

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Customers",
    );

    /* ---------------------------------------------------------------------- */
    /* WRITE FILE                                                             */
    /* ---------------------------------------------------------------------- */

    const buffer =
      XLSX.write(
        workbook,
        {
          type: "buffer",
          bookType:
            "xlsx",
        },
      );

    const filename =
      `WorkspaceHub-Customers-${new Date()
        .toISOString()
        .slice(0, 10)}.xlsx`;

    /* ---------------------------------------------------------------------- */
    /* RESPONSE                                                               */
    /* ---------------------------------------------------------------------- */

    return new NextResponse(
      buffer,
      {
        status: 200,

        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",

          "Content-Disposition":
            `attachment; filename="${filename}"`,

          "Cache-Control":
            "no-store",

          "X-Content-Type-Options":
            "nosniff",
        },
      },
    );
  } catch (error) {
    console.error(
      "Customer Excel export failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Could not export customers.",
      },
      {
        status: 500,
      },
    );
  }
}