import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";

import {
  finishGoogleWebAuthorization,
  startGoogleAuthorization,
} from "@/lib/google-calendar";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE_COOKIE =
  "wsh_google_calendar_oauth_state";

const STATE_MAX_AGE_SECONDS =
  10 * 60;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/api/google-calendar/auth",
    maxAge: STATE_MAX_AGE_SECONDS,
  };
}

export async function POST() {
  try {
    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        {
          status: 401,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    if (!canManage(user.role)) {
      return NextResponse.json(
        {
          error:
            "You do not have permission to manage Google Calendar.",
        },
        {
          status: 403,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );
    }

    const result =
      await startGoogleAuthorization();

    if (
      !result ||
      typeof result.url !==
        "string" ||
      !result.url.trim()
    ) {
      throw new Error(
        "Authorization returned an invalid URL.",
      );
    }

    const response =
      NextResponse.json(
        {
          ok: true,
          url: result.url,
          mode: result.mode,
        },
        {
          status: 200,
          headers: {
            "Cache-Control":
              "no-store",
          },
        },
      );

    if (
      result.mode === "web" &&
      result.state
    ) {
      response.cookies.set(
        STATE_COOKIE,
        result.state,
        cookieOptions(),
      );
    }

    return response;
  } catch (error) {
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
          "Cache-Control":
            "no-store",
        },
      },
    );
  }
}

export async function GET(
  request: Request,
) {
  try {
    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.redirect(
        new URL(
          "/login?googleCalendar=unauthorized",
          request.url,
        ),
      );
    }

    if (!canManage(user.role)) {
      return NextResponse.redirect(
        new URL(
          "/settings?googleCalendar=forbidden",
          request.url,
        ),
      );
    }

    const requestUrl =
      new URL(request.url);

    const errorParam =
      requestUrl.searchParams.get(
        "error",
      );

    const response =
      NextResponse.redirect(
        new URL(
          "/settings",
          request.url,
        ),
      );

    const clearStateCookie = () => {
      response.cookies.set(
        STATE_COOKIE,
        "",
        {
          ...cookieOptions(),
          maxAge: 0,
        },
      );
    };

    if (errorParam) {
      clearStateCookie();

      response.headers.set(
        "Location",
        new URL(
          "/settings?googleCalendar=cancelled",
          request.url,
        ).toString(),
      );

      return response;
    }

    const code =
      requestUrl.searchParams.get(
        "code",
      );

    const returnedState =
      requestUrl.searchParams.get(
        "state",
      );

    const cookieStore =
      await cookies();

    const cookieState =
      cookieStore.get(
        STATE_COOKIE,
      )?.value ?? null;

    if (
      !code ||
      !returnedState ||
      !cookieState ||
      returnedState !==
        cookieState
    ) {
      clearStateCookie();

      response.headers.set(
        "Location",
        new URL(
          "/settings?googleCalendar=invalid_state",
          request.url,
        ).toString(),
      );

      return response;
    }

    await finishGoogleWebAuthorization(
      code,
    );

    clearStateCookie();

    response.headers.set(
      "Location",
      new URL(
        "/settings?googleCalendar=connected",
        request.url,
      ).toString(),
    );

    return response;
  } catch (error) {
    console.error(
      "[Google Calendar] CALLBACK ERROR:",
      error,
    );

    return NextResponse.redirect(
      new URL(
        "/settings?googleCalendar=error",
        request.url,
      ),
    );
  }
}
