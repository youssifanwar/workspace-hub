import { NextResponse } from "next/server";

import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";

import {
  getGoogleCalendarStatus,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    // ---------------------------------------------------------------------------
    // AUTHENTICATION
    // ---------------------------------------------------------------------------

    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    // ---------------------------------------------------------------------------
    // AUTHORIZATION
    // ---------------------------------------------------------------------------

    if (!canManage(user.role)) {
      return NextResponse.json(
        {
          error:
            "You do not have permission to view Google Calendar settings.",
        },
        {
          status: 403,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    // ---------------------------------------------------------------------------
    // GOOGLE CALENDAR STATUS
    // ---------------------------------------------------------------------------

    const status = await getGoogleCalendarStatus();

    // ---------------------------------------------------------------------------
    // RESPONSE
    // ---------------------------------------------------------------------------

    return NextResponse.json(
      status,
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "[Google Calendar] STATUS ERROR:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Could not check Google Calendar status.",
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