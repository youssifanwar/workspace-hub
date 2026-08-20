import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, isAdmin, hashPassword } from "@/lib/auth";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as {
    username?: string;
    fullName?: string;
    password?: string;
    role?: "admin" | "manager" | "employee";
  };
  if (!body.username?.trim() || !body.fullName?.trim() || !body.password)
    return NextResponse.json(
      { error: "username, fullName, password required" },
      { status: 400 },
    );
  if (body.password.length < 6)
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 },
    );

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.username, body.username.trim()))
    .limit(1);
  if (existing.length > 0)
    return NextResponse.json({ error: "Username already exists" }, { status: 400 });

  const [row] = await db
    .insert(users)
    .values({
      username: body.username.trim(),
      fullName: body.fullName.trim(),
      passwordHash: hashPassword(body.password),
      role: body.role || "employee",
    })
    .returning();
  return NextResponse.json({ ok: true, user: { id: row.id, username: row.username } });
}
