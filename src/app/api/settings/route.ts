import { NextResponse } from "next/server";
import { getCurrentUser, canManage } from "@/lib/auth";
import { setSetting, SettingKey } from "@/lib/settings";

const ALLOWED_KEYS: SettingKey[] = [
  "workspace_name",
  "workspace_address",
  "workspace_phone",
  "currency",
  "invoice_footer",
  "auto_print_orders",
  "kitchen_printer_name",
  "invoice_printer_name",
  "public_base_url",
];

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManage(user.role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await req.json()) as Record<string, string>;
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_KEYS.includes(k as SettingKey) && typeof v === "string") {
      await setSetting(k as SettingKey, v);
    }
  }
  return NextResponse.json({ ok: true });
}
