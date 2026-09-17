import { NextResponse } from "next/server";

import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";

import {
  startGoogleAuthorization,
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
            "You do not have permission to manage Google Calendar.",
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
    // START GOOGLE OAUTH
    // ---------------------------------------------------------------------------

    const result = await startGoogleAuthorization();

    if (
      !result ||
      typeof result.url !== "string" ||
      !result.url.trim()
    ) {
      console.error(
        "[Google Calendar] Authorization returned an invalid URL.",
      );

      return NextResponse.json(
        {
          error: "Failed to start Google Calendar authorization.",
        },
        {
          status: 500,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    // ---------------------------------------------------------------------------
    // RESPONSE
    // ---------------------------------------------------------------------------

    return NextResponse.json(
      {
        ok: true,
        url: result.url,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    // Log the complete server-side error, but do not expose internal
    // implementation details to the browser.
    console.error(
      "[Google Calendar] AUTH ERROR:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          "Failed to start Google Calendar authorization.",
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