import { NextResponse } from "next/server";

import { count, eq } from "drizzle-orm";

import { db } from "@/db";
import { auditLogs, users } from "@/db/schema";
import { getCurrentUser, hashPassword, isAdmin } from "@/lib/auth";

const VALID_ROLES = new Set(["admin", "manager", "employee"]);

type UpdateBody = {
  role?: unknown;
  active?: unknown;
  newPassword?: unknown;
  fullName?: unknown;
};

function jsonError(error: string, status: number) {
  return NextResponse.json(
    { error },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const me = await getCurrentUser();

  if (!me) {
    return jsonError("Unauthorized", 401);
  }

  if (!isAdmin(me.role)) {
    return jsonError("Forbidden", 403);
  }

  const { id } = await params;

  const userId = Number(id);

  if (!Number.isSafeInteger(userId) || userId <= 0) {
    return jsonError("Invalid user id", 400);
  }

  let body: UpdateBody;

  try {
    const parsed = await req.json();

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError("Invalid request body", 400);
    }

    body = parsed as UpdateBody;
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const hasRole = Object.prototype.hasOwnProperty.call(body, "role");
  const hasActive = Object.prototype.hasOwnProperty.call(body, "active");
  const hasPassword = Object.prototype.hasOwnProperty.call(
    body,
    "newPassword",
  );
  const hasFullName = Object.prototype.hasOwnProperty.call(body, "fullName");

  if (!hasRole && !hasActive && !hasPassword && !hasFullName) {
    return NextResponse.json(
      { ok: true, updated: false },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }

  let nextRole: "admin" | "manager" | "employee" | undefined;
  let nextActive: boolean | undefined;
  let nextFullName: string | undefined;
  let nextPasswordHash: string | undefined;

  if (hasRole) {
    if (typeof body.role !== "string" || !VALID_ROLES.has(body.role)) {
      return jsonError("Invalid role", 400);
    }

    nextRole = body.role as "admin" | "manager" | "employee";
  }

  if (hasActive) {
    if (typeof body.active !== "boolean") {
      return jsonError("Invalid active value", 400);
    }

    nextActive = body.active;
  }

  if (hasFullName) {
    if (typeof body.fullName !== "string") {
      return jsonError("Invalid full name", 400);
    }

    const trimmedName = body.fullName.trim();

    if (trimmedName.length < 1 || trimmedName.length > 200) {
      return jsonError("Full name must be between 1 and 200 characters", 400);
    }

    nextFullName = trimmedName;
  }

  if (hasPassword) {
    if (typeof body.newPassword !== "string") {
      return jsonError("Invalid password", 400);
    }

    if (
      body.newPassword.length < 6 ||
      body.newPassword.length > 128
    ) {
      return jsonError(
        "Password must be between 6 and 128 characters",
        400,
      );
    }

    nextPasswordHash = hashPassword(body.newPassword);
  }

  try {
    const result = await db.transaction(async (tx) => {
      /*
       * Lock the target user row so two admin requests cannot update
       * the same account concurrently.
       */
      const targetRows = await tx
        .select({
          id: users.id,
          username: users.username,
          fullName: users.fullName,
          role: users.role,
          active: users.active,
        })
        .from(users)
        .where(eq(users.id, userId))
        .for("update");

      const target = targetRows[0];

      if (!target) {
        return {
          kind: "not_found" as const,
        };
      }

      /*
       * Do not allow an admin to deactivate their own currently used account.
       * Otherwise they can immediately lose access to the admin panel.
       */
      if (userId === me.id && nextActive === false) {
        return {
          kind: "self_deactivate" as const,
        };
      }

      const resultingRole = nextRole ?? target.role;
      const resultingActive = nextActive ?? target.active;

      /*
       * Prevent the system from ending up with zero active administrators.
       */
      if (
        (target.role === "admin" && nextRole && nextRole !== "admin") ||
        (target.role === "admin" && nextActive === false)
      ) {
        const activeAdminCountRows = await tx
          .select({
            value: count(),
          })
          .from(users)
          .where(
            eq(users.role, "admin"),
          );

        const activeAdmins = Number(
          activeAdminCountRows[0]?.value ?? 0,
        );

        /*
         * Count only active admins accurately when checking whether this
         * particular admin can be removed from the active admin set.
         */
        if (target.active) {
          const activeAdminRows = await tx
            .select({
              id: users.id,
            })
            .from(users)
            .where(eq(users.role, "admin"));

          const activeAdminIds = activeAdminRows.map((row) => row.id);
          const includesTarget = activeAdminIds.includes(target.id);

          const effectiveActiveAdmins = includesTarget
            ? activeAdmins
            : activeAdmins + 1;

          if (effectiveActiveAdmins <= 1) {
            return {
              kind: "last_admin" as const,
            };
          }
        }
      }

      const update: {
        role?: "admin" | "manager" | "employee";
        active?: boolean;
        passwordHash?: string;
        fullName?: string;
      } = {};

      if (nextRole !== undefined && nextRole !== target.role) {
        update.role = nextRole;
      }

      if (nextActive !== undefined && nextActive !== target.active) {
        update.active = nextActive;
      }

      if (nextFullName !== undefined && nextFullName !== target.fullName) {
        update.fullName = nextFullName;
      }

      if (nextPasswordHash !== undefined) {
        update.passwordHash = nextPasswordHash;
      }

      if (Object.keys(update).length === 0) {
        return {
          kind: "unchanged" as const,
          target,
        };
      }

      await tx
        .update(users)
        .set(update)
        .where(eq(users.id, userId));

      await tx.insert(auditLogs).values({
        userId: me.id,
        action: "user_updated",
        entityType: "user",
        entityId: userId,
        details: {
          targetUserId: userId,
          targetUsername: target.username,
          changes: {
            role:
              nextRole !== undefined && nextRole !== target.role
                ? {
                    from: target.role,
                    to: resultingRole,
                  }
                : undefined,
            active:
              nextActive !== undefined && nextActive !== target.active
                ? {
                    from: target.active,
                    to: resultingActive,
                  }
                : undefined,
            fullName:
              nextFullName !== undefined &&
              nextFullName !== target.fullName
                ? true
                : undefined,
            passwordChanged:
              nextPasswordHash !== undefined ? true : undefined,
          },
        },
      });

      return {
        kind: "updated" as const,
        target,
      };
    });

    if (result.kind === "not_found") {
      return jsonError("User not found", 404);
    }

    if (result.kind === "self_deactivate") {
      return jsonError("You cannot deactivate your own account", 400);
    }

    if (result.kind === "last_admin") {
      return jsonError(
        "At least one active admin account must remain",
        400,
      );
    }

    if (result.kind === "unchanged") {
      return NextResponse.json(
        {
          ok: true,
          updated: false,
        },
        {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
          },
        },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        updated: true,
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error: unknown) {
    console.error("PATCH /api/users/[id] failed:", error);

    return jsonError("Failed to update user", 500);
  }
}