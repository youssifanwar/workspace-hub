import { NextResponse } from "next/server";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";

import {
  createSession,
  verifyPassword,
} from "@/lib/auth";

import { ensureSeeded } from "@/lib/seed";

type LoginRequestBody = {
  username?: unknown;
  password?: unknown;
};

function isString(value: unknown): value is string {
  return typeof value === "string";
}

export async function POST(req: Request) {
  try {
    // ---------------------------------------------------------------------------
    // ENSURE INITIAL DATA
    // ---------------------------------------------------------------------------

    await ensureSeeded();

    // ---------------------------------------------------------------------------
    // REQUEST BODY
    // ---------------------------------------------------------------------------

    const body = (await req.json().catch(() => null)) as
      | LoginRequestBody
      | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        {
          error: "Invalid request body",
        },
        {
          status: 400,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // INPUT VALIDATION
    // ---------------------------------------------------------------------------

    if (!isString(body.username) || !isString(body.password)) {
      return NextResponse.json(
        {
          error: "Missing credentials",
        },
        {
          status: 400,
        },
      );
    }

    const username = body.username.trim();
    const password = body.password;

    if (!username || !password) {
      return NextResponse.json(
        {
          error: "Missing credentials",
        },
        {
          status: 400,
        },
      );
    }

    if (username.length > 100) {
      return NextResponse.json(
        {
          error: "Invalid credentials",
        },
        {
          status: 401,
        },
      );
    }

    if (password.length > 128) {
      return NextResponse.json(
        {
          error: "Invalid credentials",
        },
        {
          status: 401,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // FIND ACTIVE USER
    // ---------------------------------------------------------------------------

    const [user] = await db
      .select({
        id: users.id,
        passwordHash: users.passwordHash,
        active: users.active,
      })
      .from(users)
      .where(
        and(
          eq(users.username, username),
          eq(users.active, true),
        ),
      )
      .limit(1);

    // ---------------------------------------------------------------------------
    // VERIFY PASSWORD
    //
    // Keep the same generic response for both:
    // - unknown username
    // - wrong password
    //
    // This avoids exposing whether an account exists.
    // ---------------------------------------------------------------------------

    if (!user) {
      return NextResponse.json(
        {
          error: "Invalid credentials",
        },
        {
          status: 401,
        },
      );
    }

    const passwordValid = verifyPassword(
      password,
      user.passwordHash,
    );

    if (!passwordValid) {
      return NextResponse.json(
        {
          error: "Invalid credentials",
        },
        {
          status: 401,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // CREATE SESSION
    // ---------------------------------------------------------------------------

    await createSession(user.id);

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
    console.error("Login error:", error);

    return NextResponse.json(
      {
        error: "Login failed",
      },
      {
        status: 500,
      },
    );
  }
}