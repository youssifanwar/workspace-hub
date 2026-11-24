// Small Arabic (Egyptian) display helpers shared by the redesigned screens.
// Digits stay Western (0-9) to match how the business already reads figures.

const LOCALE = "ar-EG-u-nu-latn";

export function arMoney(value: number | string | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  return `${safe.toLocaleString("en-US", { maximumFractionDigits: 2 })} ج.م`;
}

export function arNumber(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function arTime(value: Date | string | null | undefined, timeZone?: string): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString(LOCALE, { hour: "numeric", minute: "2-digit", timeZone });
}

export function arDate(value: Date | string | null | undefined, timeZone?: string): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(LOCALE, { day: "numeric", month: "short", timeZone });
}

export function arDateTime(value: Date | string | null | undefined, timeZone?: string): string {
  if (!value) return "—";
  return `${arDate(value, timeZone)} · ${arTime(value, timeZone)}`;
}

export function arLongDate(value: Date, timeZone?: string): string {
  return value.toLocaleDateString(LOCALE, { weekday: "long", day: "numeric", month: "long", timeZone });
}

export function arDuration(from: Date | string, to?: Date | string | null): string {
  const a = new Date(from).getTime();
  const b = to ? new Date(to).getTime() : Date.now();
  const mins = Math.max(0, Math.floor((b - a) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} د`;
  return `${h} س ${m} د`;
}

export const PAYMENT_LABEL: Record<string, string> = {
  cash: "كاش",
  visa: "فيزا",
  instapay: "إنستاباي",
  balance: "رصيد العميل",
  bank: "بنك",
  card: "كارت",
};

export function paymentLabel(method: string | null | undefined): string {
  if (!method) return "—";
  return PAYMENT_LABEL[method] ?? method;
}
