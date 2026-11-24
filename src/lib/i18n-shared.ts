// Arabic is the source text; EN maps it to English for the app shell.
// Pages not listed here keep their Arabic/English text as written.
import { EN_EXTRA, AR_EXTRA } from "./i18n-dict";
export type Lang = "ar" | "en";

const EN: Record<string, string> = {
  "التشغيل": "Operations",
  "الكافيه والمبيعات": "Cafe & sales",
  "الإدارة": "Management",
  "لوحة التحكم": "Dashboard",
  "شيفتي": "My shift",
  "إدارة الشيفت": "Shift management",
  "الجلسات والحجوزات": "Sessions & bookings",
  "غرف الاجتماعات": "Meeting rooms",
  "طلبات المشروبات": "Drink orders",
  "المنيو والمخزون": "Menu & stock",
  "بيع مباشر": "Direct sale",
  "المخزون": "Inventory",
  "أكواد QR": "QR codes",
  "العملاء": "Customers",
  "الباقات": "Packages",
  "البنك": "Bank",
  "المصاريف والإيرادات": "Expenses & income",
  "التقارير": "Reports",
  "لوحة المالك": "Owner admin",
  "الإعدادات": "Settings",
  "ورك سبيس هب": "WorkSpace Hub",
  "إغلاق القائمة": "Close menu",
  "فتح القائمة": "Open menu",
  "قائمة التنقل": "Navigation",
  "التنقل الرئيسي": "Main navigation",
  "افتح شيفت الأول": "Open a shift first",
  "يحتاج شيفت مفتوح": "Needs an open shift",
  "الشيفت مفتوح": "Shift open",
  "مفيش شيفت مفتوح": "No shift open",
  "افتح شيفت عشان تبدأ الشغل": "Open a shift to start work",
  "تسجيل الخروج": "Log out",
  "تعذر تسجيل الخروج.": "Could not log out.",
  "مفيش اتصال بالسيرفر. جرّب تاني.": "No connection to the server. Try again.",
  "إغلاق": "Close",
  "English": "العربية",
};

export function tr(lang: Lang, s: string): string {
  if (lang === "en") return EN[s] ?? EN_EXTRA[s] ?? s;
  return AR_EXTRA[s] ?? s;
}

// ---- formatting + text helper bound to a language ----
const PAY_EN: Record<string, string> = { cash: "Cash", visa: "Visa", instapay: "InstaPay", balance: "Customer balance", bank: "Bank", card: "Card" };
const PAY_AR: Record<string, string> = { cash: "كاش", visa: "فيزا", instapay: "إنستاباي", balance: "رصيد العميل", bank: "بنك", card: "كارت" };

export function makeFmt(lang: Lang) {
  const en = lang === "en";
  const loc = en ? "en-GB" : "ar-EG-u-nu-latn";
  const toDate = (v: Date | string | null | undefined) => {
    if (!v) return null;
    const d = typeof v === "string" ? new Date(v) : v;
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const num = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const f = {
    lang,
    en,
    /** Arabic source text -> English when lang is en (falls back to the Arabic). */
    t: (s: string) => tr(lang, s),
    number: num,
    money(value: number | string | null | undefined) {
      const n = typeof value === "string" ? Number(value) : (value ?? 0);
      return `${num(Number.isFinite(n) ? n : 0)} ${en ? "EGP" : "ج.م"}`;
    },
    cur: en ? "EGP" : "ج.م",
    time(v: Date | string | null | undefined, timeZone?: string) {
      const d = toDate(v);
      return d ? d.toLocaleTimeString(loc, { hour: "numeric", minute: "2-digit", timeZone }) : "—";
    },
    date(v: Date | string | null | undefined, timeZone?: string) {
      const d = toDate(v);
      return d ? d.toLocaleDateString(loc, { day: "numeric", month: "short", timeZone }) : "—";
    },
    dateTime(v: Date | string | null | undefined, timeZone?: string) {
      return toDate(v) ? `${f.date(v, timeZone)} · ${f.time(v, timeZone)}` : "—";
    },
    longDate(v: Date, timeZone?: string) {
      return v.toLocaleDateString(loc, { weekday: "long", day: "numeric", month: "long", timeZone });
    },
    weekday(v: Date, timeZone?: string) {
      return v.toLocaleDateString(loc, { weekday: en ? "short" : "long", timeZone });
    },
    duration(from: Date | string, to?: Date | string | null) {
      const mins = Math.max(0, Math.floor(((to ? new Date(to).getTime() : Date.now()) - new Date(from).getTime()) / 60000));
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      if (en) return h === 0 ? `${m}m` : `${h}h ${m}m`;
      return h === 0 ? `${m} د` : `${h} س ${m} د`;
    },
    pay(method: string | null | undefined) {
      if (!method) return "—";
      return (en ? PAY_EN : PAY_AR)[method] ?? method;
    },
  };
  return f;
}
