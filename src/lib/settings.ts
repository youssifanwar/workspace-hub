import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

/* ============================================================================
 * SETTING KEYS
 * ========================================================================== */

export type SettingKey =
  | "workspace_name"
  | "workspace_address"
  | "workspace_phone"
  | "currency"
  | "invoice_footer"
  | "auto_print_orders"
  | "kitchen_printer_name"
  | "invoice_printer_name"
  | "public_base_url"
  | "customer_session_1h"
  | "customer_session_2h"
  | "customer_session_3h"
  | "customer_session_4h"
  | "customer_session_day_pass";

/* ============================================================================
 * DEFAULTS
 * ========================================================================== */

const DEFAULTS: Record<
  SettingKey,
  string
> = {
  workspace_name:
    "WorkSpace Hub",

  workspace_address:
    "",

  workspace_phone:
    "",

  currency:
    "EGP",

  invoice_footer:
    "Thank you for visiting! نتشرف بزيارتكم مرة أخرى",

  auto_print_orders:
    "0",

  kitchen_printer_name:
    "",

  invoice_printer_name:
    "",

  public_base_url:
    "",

  /* --------------------------------------------------------------------------
   * CUSTOMER SESSION PRICING
   *
   * Exact business rules:
   * 1h  = 40
   * 2h  = 70
   * 3h  = 100
   * 4h  = 130
   * >4h = 150 Day Pass
   * ------------------------------------------------------------------------ */

  customer_session_1h:
    "40.00",

  customer_session_2h:
    "70.00",

  customer_session_3h:
    "100.00",

  customer_session_4h:
    "130.00",

  customer_session_day_pass:
    "150.00",
};

/* ============================================================================
 * BASIC GET
 * ========================================================================== */

export async function getSetting(
  key: SettingKey,
): Promise<string> {
  const rows =
    await db
      .select({
        value:
          settings.value,
      })
      .from(settings)
      .where(
        eq(
          settings.key,
          key,
        ),
      )
      .limit(1);

  return (
    rows[0]?.value ??
    DEFAULTS[key]
  );
}

/* ============================================================================
 * GET ALL
 * ========================================================================== */

export async function getAllSettings(): Promise<
  Record<SettingKey, string>
> {
  const rows =
    await db
      .select({
        key:
          settings.key,
        value:
          settings.value,
      })
      .from(settings);

  const result: Record<
    SettingKey,
    string
  > = {
    ...DEFAULTS,
  };

  for (const row of rows) {
    if (
      Object.prototype.hasOwnProperty.call(
        DEFAULTS,
        row.key,
      )
    ) {
      result[
        row.key as SettingKey
      ] = row.value;
    }
  }

  return result;
}

/* ============================================================================
 * SET
 * ========================================================================== */

export async function setSetting(
  key: SettingKey,
  value: string,
): Promise<void> {
  await db
    .insert(settings)
    .values({
      key,
      value,
    })
    .onConflictDoUpdate({
      target:
        settings.key,

      set: {
        value,
      },
    });
}

/* ============================================================================
 * CUSTOMER SESSION PRICING
 * ========================================================================== */

export type CustomerSessionPricing = {
  oneHour: number;
  twoHours: number;
  threeHours: number;
  fourHours: number;
  dayPass: number;
};

function parsePositiveMoney(
  value: string,
  fallback: string,
): number {
  const parsed =
    Number(value);

  if (
    !Number.isFinite(parsed) ||
    parsed <= 0
  ) {
    return Number(
      fallback,
    );
  }

  return (
    Math.round(
      parsed * 100,
    ) / 100
  );
}

export async function getCustomerSessionPricing(): Promise<CustomerSessionPricing> {
  const all =
    await getAllSettings();

  return {
    oneHour:
      parsePositiveMoney(
        all.customer_session_1h,
        DEFAULTS.customer_session_1h,
      ),

    twoHours:
      parsePositiveMoney(
        all.customer_session_2h,
        DEFAULTS.customer_session_2h,
      ),

    threeHours:
      parsePositiveMoney(
        all.customer_session_3h,
        DEFAULTS.customer_session_3h,
      ),

    fourHours:
      parsePositiveMoney(
        all.customer_session_4h,
        DEFAULTS.customer_session_4h,
      ),

    dayPass:
      parsePositiveMoney(
        all.customer_session_day_pass,
        DEFAULTS.customer_session_day_pass,
      ),
  };
}

/* ============================================================================
 * CUSTOMER SESSION BILLING
 * ========================================================================== */

export function calculateCustomerSessionSeatCharge(
  billableHours: number,
  pricing: CustomerSessionPricing,
): number {
  if (
    !Number.isInteger(
      billableHours,
    ) ||
    billableHours <= 0
  ) {
    throw new Error(
      "Billable session hours must be a positive whole number.",
    );
  }

  switch (
    billableHours
  ) {
    case 1:
      return pricing.oneHour;

    case 2:
      return pricing.twoHours;

    case 3:
      return pricing.threeHours;

    case 4:
      return pricing.fourHours;

    default:
      return pricing.dayPass;
  }
}

/* ============================================================================
 * MONEY FORMAT
 * ========================================================================== */

export function formatMoney(
  value:
    | number
    | string,
  currency = "EGP",
): string {
  const amount =
    typeof value ===
    "string"
      ? Number(value)
      : value;

  if (
    !Number.isFinite(
      amount,
    )
  ) {
    return `0.00 ${currency}`;
  }

  return `${amount.toFixed(
    2,
  )} ${currency}`;
}