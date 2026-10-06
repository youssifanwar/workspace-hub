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
  | "customer_session_tiers"
  | "customer_session_day_pass"
  | "meeting_room_early_checkin_minutes"
  | "stale_session_hours";

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
   * `customer_session_tiers` is a JSON array of { hours, price }, any
   * number of tiers, fully editable from Settings — NOT fixed to
   * 1/2/3/4 hours. `customer_session_day_pass` is the flat rate charged
   * once a session runs longer than the last configured tier.
   *
   * These values are only the fallback used the very first time the app
   * runs, before an admin has saved pricing from Settings.
   * ------------------------------------------------------------------------ */

  customer_session_tiers:
    '[{"hours":1,"price":40},{"hours":2,"price":70},{"hours":3,"price":100},{"hours":4,"price":130}]',

  customer_session_day_pass:
    "150.00",
  /* How many minutes BEFORE the reserved start time a customer may be
   * checked in to a meeting room. Editable in Settings. */
  meeting_room_early_checkin_minutes:
    "30",
  /* Sessions open longer than this many hours are flagged as possibly
   * forgotten. Editable in Settings. */
  stale_session_hours:
    "10",
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

export type SessionPricingTier = {
  hours: number;
  price: number;
};

export type CustomerSessionPricing = {
  /** Sorted ascending by `hours`. Any number of tiers is supported. */
  tiers: SessionPricingTier[];
  /** Flat rate for a session longer than the last tier. */
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

/**
 * Parses and validates the `customer_session_tiers` JSON setting. Invalid,
 * missing or empty input falls back to the shipped default tiers (this is
 * a safety net so billing never breaks — not a hardcoded business rule).
 */
export function parseSessionTiers(raw: string): SessionPricingTier[] {
  const fallback = (): SessionPricingTier[] =>
    (
      JSON.parse(
        DEFAULTS.customer_session_tiers,
      ) as Array<{ hours: unknown; price: unknown }>
    ).map((t) => ({
      hours: Number(t.hours),
      price: Number(t.price),
    }));

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback();
  }
  if (!Array.isArray(parsed)) return fallback();

  const byHours = new Map<number, number>();
  for (const entry of parsed) {
    if (
      !entry ||
      typeof entry !== "object" ||
      !("hours" in entry) ||
      !("price" in entry)
    ) {
      continue;
    }
    const hours = Number((entry as { hours: unknown }).hours);
    const price = Number((entry as { price: unknown }).price);
    if (
      !Number.isFinite(hours) ||
      !Number.isInteger(hours) ||
      hours <= 0 ||
      hours > 24 * 31 ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      continue;
    }
    // A later duplicate hour value overrides an earlier one.
    byHours.set(hours, Math.round(price * 100) / 100);
  }

  const tiers = Array.from(byHours.entries())
    .map(([hours, price]) => ({ hours, price }))
    .sort((a, b) => a.hours - b.hours);

  return tiers.length > 0 ? tiers : fallback();
}

export function serializeSessionTiers(
  tiers: SessionPricingTier[],
): string {
  return JSON.stringify(
    tiers
      .filter(
        (t) =>
          Number.isInteger(t.hours) &&
          t.hours > 0 &&
          Number.isFinite(t.price) &&
          t.price >= 0,
      )
      .sort((a, b) => a.hours - b.hours),
  );
}

export async function getCustomerSessionPricing(): Promise<CustomerSessionPricing> {
  const all =
    await getAllSettings();

  return {
    tiers: parseSessionTiers(all.customer_session_tiers),

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

/**
 * Finds the price for a session of `billableHours` whole hours: the
 * cheapest tier whose `hours` covers the session, or the day-pass rate if
 * the session runs longer than every configured tier. Supports any number
 * of tiers — adding, removing or renumbering them in Settings needs no
 * code change.
 */
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

  const sorted = [...pricing.tiers].sort(
    (a, b) => a.hours - b.hours,
  );

  for (const tier of sorted) {
    if (billableHours <= tier.hours) {
      return tier.price;
    }
  }

  return pricing.dayPass;
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