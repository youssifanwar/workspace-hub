import { NextResponse } from "next/server";
import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";
import {
  getGoogleCalendarStatus,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export async function GET() {
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
            "You do not have permission to view Google Calendar settings.",
        },
        {
          status: 403,
        },
      );
    }

    const status =
      await getGoogleCalendarStatus();

    return NextResponse.json(
      status,
    );
  } catch (error) {
    console.error(
      "Google Calendar status error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Could not check Google Calendar status.",
      },
      {
        status: 500,
      },
    );
  }
}