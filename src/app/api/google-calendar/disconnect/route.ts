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
    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    if (!canManage(user.role)) {
      return NextResponse.json(
        {
          error:
            "You do not have permission to manage Google Calendar.",
        },
        { status: 403 },
      );
    }

    await disconnectGoogleCalendar();

    return NextResponse.json(
      {
        ok: true,
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "Google Calendar disconnect error:",
      error,
    );

    return NextResponse.json(
      {
        ok: false,
        error:
          "Could not disconnect Google Calendar.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control":
            "no-store",
        },
      },
    );
  }
}
