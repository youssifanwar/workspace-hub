import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";

import { getLang } from "@/lib/i18n";
import { makeFmt } from "@/lib/i18n-shared";
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
  const f = makeFmt(await getLang());
  const tx = f.t;

  const user = await getCurrentUser();

  if (user) {
    redirect("/dashboard");
  }

  return (
    <main className="login-page min-h-screen grid lg:grid-cols-2">
      <section
        aria-hidden="true"
        className="login-showcase hidden lg:flex relative overflow-hidden bg-gradient-to-br from-[#3b2112] via-[#52321d] to-[#6b4228] text-white p-12 items-center justify-center"
      >
        <div className="login-showcase-orb login-showcase-orb-one absolute -top-20 -left-20 w-96 h-96 bg-white/10 rounded-full blur-3xl" />
        <div className="login-showcase-orb login-showcase-orb-two absolute -bottom-20 -right-20 w-96 h-96 bg-white/10 rounded-full blur-3xl" />
        <div className="login-showcase-grid" aria-hidden="true" />

        <div className="login-brand-content relative z-10 max-w-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="login-logo" src="/scope-logo-cream.png" alt="Scope Space" width={909} height={486} />

          <div className="login-showcase-eyebrow">{tx("THE WORKSPACE OPERATING SYSTEM")}</div>

          <p className="text-lg text-white/90 leading-relaxed">
            {tx("Modern coworking management. Book desks, run shifts, manage F&B orders, and track revenue, all in one clean interface.")}
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
                <span>{tx(feature)}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="login-form-panel flex items-center justify-center p-8">
        <div className="login-card w-full max-w-md card p-8">
          <div className="mb-6">
            <div className="login-form-mark mb-4" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22" fill="none"><path d="M12 3v18M3 12h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/><circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.4"/></svg></div>
            <div className="login-form-eyebrow">{tx("SECURE WORKSPACE ACCESS")}</div>

            <h2 className="text-2xl font-bold text-slate-900 mt-2">
              {tx("Welcome back")}
            </h2>

            <p className="text-sm text-slate-500 mt-1">
              {tx("Sign in to continue to your operations console.")}
            </p>
          </div>

          <LoginForm />
          <div className="login-card-footer"><span className="login-footer-shield" aria-hidden="true">✓</span> {tx("Protected workspace · Authorized team members only")}</div>
        </div>
      </section>
    </main>
  );
}