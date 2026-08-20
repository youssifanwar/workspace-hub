import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { and, eq, ne } from "drizzle-orm";
import {
  getCurrentUser,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    username?: string;
    fullName?: string;
    currentPassword?: string;
    newPassword?: string;
  };

  const [current] = await db.select().from(users).where(eq(users.id, user.id));
  if (!current)
    return NextResponse.json({ error: "User not found" }, { status: 404 });

  const update: { username?: string; fullName?: string; passwordHash?: string } = {};
  if (body.fullName?.trim()) update.fullName = body.fullName.trim();
  if (body.username?.trim() && body.username.trim() !== current.username) {
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.username, body.username.trim()), ne(users.id, user.id)))
      .limit(1);
    if (existing.length > 0)
      return NextResponse.json({ error: "Username already taken" }, { status: 400 });
    update.username = body.username.trim();
  }

  if (body.newPassword) {
    if (!body.currentPassword)
      return NextResponse.json({ error: "Current password required" }, { status: 400 });
    if (!verifyPassword(body.currentPassword, current.passwordHash))
      return NextResponse.json({ error: "Current password is wrong" }, { status: 400 });
    if (body.newPassword.length < 6)
      return NextResponse.json(
        { error: "New password must be at least 6 characters" },
        { status: 400 },
      );
    update.passwordHash = hashPassword(body.newPassword);
  }

  if (Object.keys(update).length === 0)
    return NextResponse.json({ ok: true });

  await db.update(users).set(update).where(eq(users.id, user.id));
  return NextResponse.json({ ok: true });
}
