import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, isAdmin, hashPassword } from "@/lib/auth";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(me.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const userId = Number(id);
  const body = (await req.json()) as {
    role?: "admin" | "manager" | "employee";
    active?: boolean;
    newPassword?: string;
    fullName?: string;
  };

  const update: {
    role?: "admin" | "manager" | "employee";
    active?: boolean;
    passwordHash?: string;
    fullName?: string;
  } = {};
  if (body.role) update.role = body.role;
  if (typeof body.active === "boolean") update.active = body.active;
  if (body.fullName?.trim()) update.fullName = body.fullName.trim();
  if (body.newPassword) {
    if (body.newPassword.length < 6)
      return NextResponse.json(
        { error: "Password too short" },
        { status: 400 },
      );
    update.passwordHash = hashPassword(body.newPassword);
  }

  if (Object.keys(update).length === 0)
    return NextResponse.json({ ok: true });

  await db.update(users).set(update).where(eq(users.id, userId));
  return NextResponse.json({ ok: true });
}
