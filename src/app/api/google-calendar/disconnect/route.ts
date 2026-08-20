import { NextResponse } from "next/server";
import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";
import {
  disconnectGoogleCalendar,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    if (!canManage(user.role)) {
      return NextResponse.json(
        {
          error:
            "You do not have permission to disconnect Google Calendar.",
        },
        {
          status: 403,
        },
      );
    }

    disconnectGoogleCalendar();

    return NextResponse.json({
      ok: true,
      connected: false,
    });
  } catch (error) {
    console.error(
      "Google Calendar disconnect error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Could not disconnect Google Calendar.",
      },
      {
        status: 500,
      },
    );
  }
}