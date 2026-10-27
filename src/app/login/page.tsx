import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";

import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

const FEATURES = [
  "🪑 Desk & Meeting Room Booking",
  "☕ Food & Beverage POS",
  "⏱️ Automatic Hourly Billing",
  "🧾 Shift & Cash Drawer Tracking",
  "📊 Real-time Dashboard & Reports",
] as const;

export default async function LoginPage() {
  await ensureSeeded();

  const user = await getCurrentUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="login-page min-h-screen grid lg:grid-cols-2">
      <section
        aria-hidden="true"
        className="login-showcase hidden lg:flex relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-500 to-cyan-500 text-white p-12 items-center justify-center"
      >
        <div className="login-showcase-orb login-showcase-orb-one absolute -top-20 -left-20 w-96 h-96 bg-white/10 rounded-full blur-3xl" />
        <div className="login-showcase-orb login-showcase-orb-two absolute -bottom-20 -right-20 w-96 h-96 bg-white/10 rounded-full blur-3xl" />
        <div className="login-showcase-grid" aria-hidden="true" />

        <div className="login-brand-content relative z-10 max-w-md">
          <div className="login-brand-mark mb-6" aria-hidden="true"><svg viewBox="0 0 36 36" width="34" height="34" fill="none"><path d="M6 28V13.5L18 6l12 7.5V28H6Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M12 28V18h12v10M18 18v10M6 13.5h24" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="M11 11l7 4 7-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg></div>

          <div className="login-showcase-eyebrow">THE WORKSPACE OPERATING SYSTEM</div>
          <h1 className="text-4xl font-bold mb-4">
            WorkSpace Hub
          </h1>

          <p className="text-lg text-white/90 leading-relaxed">
            Modern coworking management. Book desks, run shifts, manage
            F&amp;B orders, and track revenue — all in one clean interface.
          </p>

          <div className="mt-10 space-y-3">
            {FEATURES.map((feature) => (
              <div
                key={feature}
                className="flex items-center gap-3 text-white/95"
              >
                <span
                  className="w-2 h-2 rounded-full bg-white/80 shrink-0"
                  aria-hidden="true"
                />
                <span>{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="login-form-panel flex items-center justify-center p-8">
        <div className="login-card w-full max-w-md card p-8">
          <div className="mb-6">
            <div className="login-form-mark mb-4" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M12 3v18M3 12h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.4"/></svg></div>
            <div className="login-form-eyebrow">SECURE WORKSPACE ACCESS</div>

            <h2 className="text-2xl font-bold text-slate-900 mt-2">
              Welcome back
            </h2>

            <p className="text-sm text-slate-500 mt-1">
              Sign in to continue to your operations console.
            </p>
          </div>

          <LoginForm />
          <div className="login-card-footer"><span className="login-footer-shield" aria-hidden="true">✓</span> Protected workspace · Authorized team members only</div>
        </div>
      </section>
    </main>
  );
}