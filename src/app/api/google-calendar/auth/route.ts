import { NextResponse } from "next/server";
import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";
import {
  startGoogleAuthorization,
} from "@/lib/google-calendar";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    console.log(
      "[Google Calendar] Starting authorization...",
    );

    const user =
      await getCurrentUser();

    if (!user) {
      console.error(
        "[Google Calendar] Unauthorized",
      );

      return NextResponse.json(
        {
          error: "Unauthorized",
        },
        {
          status: 401,
        },
      );
    }

    console.log(
      "[Google Calendar] User:",
      user.username,
      user.role,
    );

    if (!canManage(user.role)) {
      console.error(
        "[Google Calendar] User has no permission:",
        user.role,
      );

      return NextResponse.json(
        {
          error:
            "You do not have permission to manage Google Calendar.",
        },
        {
          status: 403,
        },
      );
    }

    // Check credentials explicitly in development.
    const credentialsPath =
      path.join(
        process.cwd(),
        "credentials.json",
      );

    console.log(
      "[Google Calendar] Credentials path:",
      credentialsPath,
    );

    console.log(
      "[Google Calendar] Credentials exists:",
      fs.existsSync(
        credentialsPath,
      ),
    );

    if (
      !fs.existsSync(
        credentialsPath,
      )
    ) {
      return NextResponse.json(
        {
          error:
            `Google credentials.json not found at:\n${credentialsPath}`,
        },
        {
          status: 500,
        },
      );
    }

    const result =
      await startGoogleAuthorization();

    console.log(
      "[Google Calendar] Authorization URL created.",
    );

    return NextResponse.json({
      ok: true,
      url: result.url,
    });
  } catch (error) {
    console.error(
      "[Google Calendar] AUTH ERROR:",
      error,
    );

    const message =
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}