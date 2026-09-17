import { NextResponse } from "next/server";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";

import {
  auditLogs,
  users,
} from "@/db/schema";

import {
  getCurrentUser,
  hashPassword,
  isAdmin,
} from "@/lib/auth";

type CreateUserBody = {
  username?: unknown;
  fullName?: unknown;
  password?: unknown;
  role?: unknown;
};

type UserRole =
  | "admin"
  | "manager"
  | "employee";

function isString(
  value: unknown,
): value is string {
  return typeof value === "string";
}

function isValidUsername(
  username: string,
): boolean {
  return /^[A-Za-z0-9._-]+$/.test(username);
}

function isValidRole(
  value: unknown,
): value is UserRole {
  return (
    value === "admin" ||
    value === "manager" ||
    value === "employee"
  );
}

export async function POST(
  req: Request,
) {
  try {
    // ---------------------------------------------------------------------------
    // AUTHENTICATION
    // ---------------------------------------------------------------------------

    const currentUser =
      await getCurrentUser();

    if (!currentUser) {
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

    if (!isAdmin(currentUser.role)) {
      return NextResponse.json(
        {
          error: "Forbidden",
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
    // REQUEST BODY
    // ---------------------------------------------------------------------------

    const body =
      (await req
        .json()
        .catch(() => null)) as
        | CreateUserBody
        | null;

    if (
      !body ||
      typeof body !== "object"
    ) {
      return NextResponse.json(
        {
          error:
            "Invalid request body",
        },
        {
          status: 400,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // USERNAME
    // ---------------------------------------------------------------------------

    if (!isString(body.username)) {
      return NextResponse.json(
        {
          error: "Username is required",
        },
        {
          status: 400,
        },
      );
    }

    const username =
      body.username.trim();

    if (!username) {
      return NextResponse.json(
        {
          error: "Username is required",
        },
        {
          status: 400,
        },
      );
    }

    if (username.length > 100) {
      return NextResponse.json(
        {
          error:
            "Username must be at most 100 characters",
        },
        {
          status: 400,
        },
      );
    }

    if (!isValidUsername(username)) {
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

    // ---------------------------------------------------------------------------
    // FULL NAME
    // ---------------------------------------------------------------------------

    if (!isString(body.fullName)) {
      return NextResponse.json(
        {
          error:
            "Full name is required",
        },
        {
          status: 400,
        },
      );
    }

    const fullName =
      body.fullName.trim();

    if (!fullName) {
      return NextResponse.json(
        {
          error:
            "Full name is required",
        },
        {
          status: 400,
        },
      );
    }

    if (fullName.length > 200) {
      return NextResponse.json(
        {
          error:
            "Full name must be at most 200 characters",
        },
        {
          status: 400,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // PASSWORD
    // ---------------------------------------------------------------------------

    if (!isString(body.password)) {
      return NextResponse.json(
        {
          error:
            "Password is required",
        },
        {
          status: 400,
        },
      );
    }

    const password =
      body.password;

    if (password.length < 6) {
      return NextResponse.json(
        {
          error:
            "Password must be at least 6 characters",
        },
        {
          status: 400,
        },
      );
    }

    if (password.length > 128) {
      return NextResponse.json(
        {
          error:
            "Password must be at most 128 characters",
        },
        {
          status: 400,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // ROLE
    // ---------------------------------------------------------------------------

    let role: UserRole =
      "employee";

    if (
      body.role !== undefined &&
      body.role !== null
    ) {
      if (!isValidRole(body.role)) {
        return NextResponse.json(
          {
            error:
              "Invalid user role",
          },
          {
            status: 400,
          },
        );
      }

      role = body.role;
    }

    // ---------------------------------------------------------------------------
    // TRANSACTION
    // ---------------------------------------------------------------------------

    const createdUser =
      await db.transaction(
        async (tx) => {
          // ---------------------------------------------------------------------
          // USERNAME LOCK
          //
          // The database unique constraint remains the final protection against
          // duplicate usernames. The advisory lock also serializes concurrent
          // application-level checks.
          // ---------------------------------------------------------------------

          await tx.execute(
            sql`
              SELECT pg_advisory_xact_lock(
                hashtextextended(
                  ${username},
                  0
                )
              )
            `,
          );

          // ---------------------------------------------------------------------
          // DUPLICATE CHECK
          // ---------------------------------------------------------------------

          const [existing] =
            await tx
              .select({
                id: users.id,
              })
              .from(users)
              .where(
                and(
                  eq(
                    users.username,
                    username,
                  ),
                ),
              )
              .limit(1);

          if (existing) {
            throw new Error(
              "USERNAME_EXISTS",
            );
          }

          // ---------------------------------------------------------------------
          // CREATE USER
          // ---------------------------------------------------------------------

          const passwordHash =
            hashPassword(password);

          const [row] =
            await tx
              .insert(users)
              .values({
                username,
                fullName,
                passwordHash,
                role,
                active: true,
              })
              .returning({
                id: users.id,
                username:
                  users.username,
                fullName:
                  users.fullName,
                role: users.role,
                active:
                  users.active,
              });

          if (!row) {
            throw new Error(
              "USER_CREATE_FAILED",
            );
          }

          // ---------------------------------------------------------------------
          // AUDIT
          // ---------------------------------------------------------------------

          await tx
            .insert(auditLogs)
            .values({
              userId:
                currentUser.id,

              action:
                "user_created",

              entityType:
                "user",

              entityId:
                row.id,

              details: {
                username:
                  row.username,

                fullName:
                  row.fullName,

                role:
                  row.role,

                active:
                  row.active,
              },
            });

          return row;
        },
      );

    // ---------------------------------------------------------------------------
    // RESPONSE
    // ---------------------------------------------------------------------------

    return NextResponse.json(
      {
        ok: true,
        user: {
          id:
            createdUser.id,

          username:
            createdUser.username,

          fullName:
            createdUser.fullName,

          role:
            createdUser.role,

          active:
            createdUser.active,
        },
      },
      {
        status: 201,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    // ---------------------------------------------------------------------------
    // EXPECTED ERRORS
    // ---------------------------------------------------------------------------

    if (
      error instanceof Error
    ) {
      if (
        error.message ===
        "USERNAME_EXISTS"
      ) {
        return NextResponse.json(
          {
            error:
              "Username already exists",
          },
          {
            status: 400,
          },
        );
      }

      if (
        error.message ===
        "USER_CREATE_FAILED"
      ) {
        return NextResponse.json(
          {
            error:
              "Could not create user",
          },
          {
            status: 500,
          },
        );
      }
    }

    // ---------------------------------------------------------------------------
    // DATABASE UNIQUE CONSTRAINT
    // ---------------------------------------------------------------------------

    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error
        ? (
            error as {
              code?: unknown;
            }
          ).code
        : undefined;

    if (code === "23505") {
      return NextResponse.json(
        {
          error:
            "Username already exists",
        },
        {
          status: 400,
        },
      );
    }

    // ---------------------------------------------------------------------------
    // GENERIC ERROR
    // ---------------------------------------------------------------------------

    console.error(
      "Create user error:",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Could not create user",
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