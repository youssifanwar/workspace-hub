import { NextResponse } from "next/server";

import { destroySession } from "@/lib/auth";

export async function POST() {
  try {
    // ---------------------------------------------------------------------------
    // DESTROY CURRENT SESSION
    // ---------------------------------------------------------------------------

    await destroySession();

    // ---------------------------------------------------------------------------
    // RESPONSE
    // ---------------------------------------------------------------------------

    return NextResponse.json(
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
    console.error("Logout error:", error);

    return NextResponse.json(
      {
        error: "Logout failed",
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