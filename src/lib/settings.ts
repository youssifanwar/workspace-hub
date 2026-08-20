import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export type SettingKey =
  | "workspace_name"
  | "workspace_address"
  | "workspace_phone"
  | "currency"
  | "invoice_footer"
  | "auto_print_orders"
  | "kitchen_printer_name"
  | "invoice_printer_name"
  | "public_base_url";

const DEFAULTS: Record<SettingKey, string> = {
  workspace_name: "WorkSpace Hub",
  workspace_address: "Cairo, Egypt",
  workspace_phone: "+20 100 000 0000",
  currency: "EGP",
  invoice_footer: "Thank you for visiting! نتشرف بزيارتكم مرة أخرى",
  auto_print_orders: "1",
  kitchen_printer_name: "",
  invoice_printer_name: "",
  public_base_url: "",
};

export async function getSetting(key: SettingKey): Promise<string> {
  const rows = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key))
    .limit(1);
  return rows[0]?.value ?? DEFAULTS[key];
}

export async function getAllSettings(): Promise<Record<SettingKey, string>> {
  const rows = await db.select().from(settings);
  const map = { ...DEFAULTS };
  for (const r of rows) {
    if (r.key in map) {
      (map as Record<string, string>)[r.key] = r.value;
    }
  }
  return map;
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
}

export function formatMoney(n: number | string, currency = "EGP"): string {
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return `0.00 ${currency}`;
  return `${num.toFixed(2)} ${currency}`;
}
