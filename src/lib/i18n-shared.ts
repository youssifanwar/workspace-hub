// Arabic is the source text; EN maps it to English for the app shell.
// Pages not listed here keep their Arabic/English text as written.
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
  return lang === "en" ? (EN[s] ?? s) : s;
}
