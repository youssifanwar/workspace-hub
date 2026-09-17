import { NextResponse } from "next/server";

import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";

import {
  disconnectGoogleCalendar,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
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
            "You do not have permission to disconnect Google Calendar.",
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
    // DISCONNECT
    //
    // disconnectGoogleCalendar() is intentionally synchronous.
    // It removes the locally stored Google OAuth token.
    // ---------------------------------------------------------------------------

    disconnectGoogleCalendar();

    // ---------------------------------------------------------------------------
    // RESPONSE
    // ---------------------------------------------------------------------------

    return NextResponse.json(
      {
        ok: true,
        connected: false,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "[Google Calendar] DISCONNECT ERROR:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error: "Could not disconnect Google Calendar.",
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