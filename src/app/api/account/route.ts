import { NextResponse } from "next/server";

import { and, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";

import {
  getCurrentUser,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";

type AccountRequestBody = {
  username?: unknown;
  fullName?: unknown;
  currentPassword?: unknown;
  newPassword?: unknown;
};

type AccountUpdate = {
  username?: string;
  fullName?: string;
  passwordHash?: string;
};

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isValidUsername(username: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(username);
}

function isValidPassword(password: string): boolean {
  return password.length >= 6 && password.length <= 128;
}

export async function PATCH(req: Request) {
  try {
    // ---------------------------------------------------------------------------
    // AUTH
    // ---------------------------------------------------------------------------

    const user = await getCurrentUser();

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

    // ---------------------------------------------------------------------------
    // REQUEST BODY
    // ---------------------------------------------------------------------------

    const body = (await req.json().catch(() => null)) as AccountRequestBody | null;

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
    // INPUT NORMALIZATION
    // ---------------------------------------------------------------------------

    const hasUsername = body.username !== undefined;
    const hasFullName = body.fullName !== undefined;
    const hasCurrentPassword = body.currentPassword !== undefined;
    const hasNewPassword = body.newPassword !== undefined;

    let nextUsername: string | undefined;
    let nextFullName: string | undefined;
    let currentPassword: string | undefined;
    let newPassword: string | undefined;

    // Username
    if (hasUsername) {
      if (!isString(body.username)) {
        return NextResponse.json(
          {
            error: "Invalid username",
          },
          {
            status: 400,
          },
        );
      }

      nextUsername = body.username.trim();

      if (!nextUsername) {
        return NextResponse.json(
          {
            error: "Username cannot be empty",
          },
          {
            status: 400,
          },
        );
      }

      if (nextUsername.length > 100) {
        return NextResponse.json(
          {
            error: "Username must be at most 100 characters",
          },
          {
            status: 400,
          },
        );
      }

      if (!isValidUsername(nextUsername)) {
        return NextResponse.json(
          {
            error:
              "Username may contain only letters, numbers, dots, underscores, and hyphens",
          },
          {
            status: 400,
          },
        );
      }
    }

    // Full name
    if (hasFullName) {
      if (!isString(body.fullName)) {
        return NextResponse.json(
          {
            error: "Invalid full name",
          },
          {
            status: 400,
          },
        );
      }

      nextFullName = body.fullName.trim();

      if (!nextFullName) {
        return NextResponse.json(
          {
            error: "Full name cannot be empty",
          },
          {
            status: 400,
          },
        );
      }

      if (nextFullName.length > 200) {
        return NextResponse.json(
          {
            error: "Full name must be at most 200 characters",
          },
          {
            status: 400,
          },
        );
      }
    }

    // Password fields
    if (hasCurrentPassword) {
      if (!isString(body.currentPassword)) {
        return NextResponse.json(
          {
            error: "Invalid current password",
          },
          {
            status: 400,
          },
        );
      }

      currentPassword = body.currentPassword;
    }

    if (hasNewPassword) {
      if (!isString(body.newPassword)) {
        return NextResponse.json(
          {
            error: "Invalid new password",
          },
          {
            status: 400,
          },
        );
      }

      newPassword = body.newPassword;
    }

    // ---------------------------------------------------------------------------
    // PASSWORD CHANGE RULES
    // ---------------------------------------------------------------------------

    if (hasCurrentPassword && !hasNewPassword) {
      return NextResponse.json(
        {
          error: "New password is required",
        },
        {
          status: 400,
        },
      );
    }

    if (hasNewPassword && !hasCurrentPassword) {
      return NextResponse.json(
        {
          error: "Current password is required",
        },
        {
          status: 400,
        },
      );
    }

    if (newPassword !== undefined) {
      if (!isValidPassword(newPassword)) {
        return NextResponse.json(
          {
            error: "New password must be between 6 and 128 characters",
          },
          {
            status: 400,
          },
        );
      }

      if (newPassword === currentPassword) {
        return NextResponse.json(
          {
            error: "New password must be different from the current password",
          },
          {
            status: 400,
          },
        );
      }
    }

    // ---------------------------------------------------------------------------
    // TRANSACTION
    // ---------------------------------------------------------------------------

    const result = await db.transaction(async (tx) => {
      // Lock the current user row so two profile/password changes cannot
      // concurrently modify the same account.
      const [current] = await tx
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      if (!current) {
        throw new Error("USER_NOT_FOUND");
      }

      const update: AccountUpdate = {};

      let usernameChanged = false;
      let fullNameChanged = false;
      let passwordChanged = false;

      // -------------------------------------------------------------------------
      // USERNAME
      // -------------------------------------------------------------------------

      if (nextUsername !== undefined && nextUsername !== current.username) {
        const [existing] = await tx
          .select({
            id: users.id,
          })
          .from(users)
          .where(
            and(
              eq(users.username, nextUsername),
              ne(users.id, user.id),
            ),
          )
          .limit(1);

        if (existing) {
          throw new Error("USERNAME_TAKEN");
        }

        update.username = nextUsername;
        usernameChanged = true;
      }

      // -------------------------------------------------------------------------
      // FULL NAME
      // -------------------------------------------------------------------------

      if (nextFullName !== undefined && nextFullName !== current.fullName) {
        update.fullName = nextFullName;
        fullNameChanged = true;
      }

      // -------------------------------------------------------------------------
      // PASSWORD
      // -------------------------------------------------------------------------

      if (newPassword !== undefined) {
        if (!currentPassword) {
          throw new Error("CURRENT_PASSWORD_REQUIRED");
        }

        const passwordMatches = verifyPassword(
          currentPassword,
          current.passwordHash,
        );

        if (!passwordMatches) {
          throw new Error("CURRENT_PASSWORD_WRONG");
        }

        update.passwordHash = hashPassword(newPassword);
        passwordChanged = true;
      }

      // -------------------------------------------------------------------------
      // NOTHING TO CHANGE
      // -------------------------------------------------------------------------

      if (Object.keys(update).length === 0) {
        return {
          updated: false,
          usernameChanged: false,
          fullNameChanged: false,
          passwordChanged: false,
        };
      }

      // -------------------------------------------------------------------------
      // UPDATE USER
      // -------------------------------------------------------------------------

      await tx
        .update(users)
        .set(update)
        .where(eq(users.id, user.id));

      // -------------------------------------------------------------------------
      // AUDIT
      // -------------------------------------------------------------------------

      await tx.insert(auditLogs).values({
        userId: user.id,
        action: "account_updated",
        entityType: "user",
        entityId: user.id,
        details: {
          usernameChanged,
          fullNameChanged,
          passwordChanged,
        },
      });

      return {
        updated: true,
        usernameChanged,
        fullNameChanged,
        passwordChanged,
      };
    });

    // ---------------------------------------------------------------------------
    // RESPONSE
    // ---------------------------------------------------------------------------

    return NextResponse.json({
      ok: true,
      updated: result.updated,
    });
  } catch (error) {
    // ---------------------------------------------------------------------------
    // EXPECTED ERRORS
    // ---------------------------------------------------------------------------

    if (error instanceof Error) {
      switch (error.message) {
        case "USER_NOT_FOUND":
          return NextResponse.json(
            {
              error: "User not found",
            },
            {
              status: 404,
            },
          );

        case "USERNAME_TAKEN":
          return NextResponse.json(
            {
              error: "Username already taken",
            },
            {
              status: 400,
            },
          );

        case "CURRENT_PASSWORD_REQUIRED":
          return NextResponse.json(
            {
              error: "Current password required",
            },
            {
              status: 400,
            },
          );

        case "CURRENT_PASSWORD_WRONG":
          return NextResponse.json(
            {
              error: "Current password is wrong",
            },
            {
              status: 400,
            },
          );
      }
    }

    // ---------------------------------------------------------------------------
    // DATABASE UNIQUE CONSTRAINT
    // ---------------------------------------------------------------------------

    const errorCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error
        ? (error as { code?: unknown }).code
        : undefined;

    if (errorCode === "23505") {
      return NextResponse.json(
        {
          error: "Username already taken",
        },
        {
          status: 400,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // GENERIC ERROR
    // ---------------------------------------------------------------------------

    console.error("Account update error:", error);

    return NextResponse.json(
      {
        error: "Failed to update account",
      },
      {
        status: 500,
      },
    );
  }
}