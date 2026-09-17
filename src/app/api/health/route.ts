import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    // ---------------------------------------------------------------------------
    // DATABASE HEALTH CHECK
    // ---------------------------------------------------------------------------

    await db.execute(sql`select 1`);

    // ---------------------------------------------------------------------------
    // HEALTHY
    // ---------------------------------------------------------------------------

    return Response.json(
      {
        ok: true,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    // Keep the actual database error server-side.
    console.error("[Health] Database check failed:", error);

    // ---------------------------------------------------------------------------
    // UNHEALTHY
    // ---------------------------------------------------------------------------

    return Response.json(
      {
        ok: false,
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}