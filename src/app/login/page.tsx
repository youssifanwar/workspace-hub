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
    <main className="min-h-screen grid lg:grid-cols-2">
      <section
        aria-hidden="true"
        className="hidden lg:flex relative overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-500 to-cyan-500 text-white p-12 items-center justify-center"
      >
        <div className="absolute -top-20 -left-20 w-96 h-96 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -right-20 w-96 h-96 bg-white/10 rounded-full blur-3xl" />

        <div className="relative z-10 max-w-md">
          <div className="text-5xl mb-6" aria-hidden="true">
            🏢
          </div>

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

      <section className="flex items-center justify-center p-8">
        <div className="w-full max-w-md card p-8">
          <div className="mb-6">
            <div className="text-3xl mb-2" aria-hidden="true">
              👋
            </div>

            <h2 className="text-2xl font-bold text-slate-900">
              Welcome back
            </h2>

            <p className="text-sm text-slate-500 mt-1">
              Sign in to start your shift
            </p>
          </div>

          <LoginForm />
        </div>
      </section>
    </main>
  );
}