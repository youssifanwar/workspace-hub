import type { ReactNode } from "react";

/**
 * Shared building blocks so every page looks and behaves the same way.
 * Server-component safe (no hooks).
 */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
          {title}
        </h1>
        {description && (
          <p className="text-slate-500 mt-1 max-w-2xl">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

export function EmptyState({
  icon = "📭",
  title,
  description,
  action,
}: {
  icon?: string;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card p-10 text-center">
      <div className="text-4xl mb-3" aria-hidden="true">
        {icon}
      </div>
      <h3 className="text-base font-bold text-slate-900">{title}</h3>
      {description && (
        <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">
          {description}
        </p>
      )}
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-xl bg-slate-200/70 ${className}`}
    />
  );
}

export function StatTile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "indigo" | "green" | "red" | "amber";
}) {
  const color =
    tone === "indigo"
      ? "text-indigo-600"
      : tone === "green"
        ? "text-emerald-600"
        : tone === "red"
          ? "text-rose-600"
          : tone === "amber"
            ? "text-amber-600"
            : "text-slate-900";
  return (
    <div className="card p-5">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </div>
      <div className={`text-2xl sm:text-3xl font-extrabold mt-1 tabular-nums ${color}`}>
        {value}
      </div>
      {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
    </div>
  );
}

/* ---------- v2 layout kit (server-safe) ---------- */

export function PageBar({
  crumb,
  title,
  description,
  actions,
}: {
  crumb?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="v2-bar">
      <div className="v2-bar-text">
        {crumb && <div className="v2-crumb">{crumb}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="v2-bar-actions">{actions}</div>}
    </header>
  );
}

export type StripItem = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "brand" | "green" | "amber" | "red" | "slate";
};

/** One card holding 2-4 headline numbers separated by hairlines. */
export function StatStrip({ items }: { items: StripItem[] }) {
  return (
    <section className="v2-strip" style={{ ["--cols" as string]: items.length }}>
      {items.map((it, i) => (
        <div key={i} className={`v2-stat st-${it.tone ?? "slate"}`}>
          <span className="v2-stat-label">{it.label}</span>
          <span className="v2-stat-value">{it.value}</span>
          {it.hint && <span className="v2-stat-hint">{it.hint}</span>}
        </div>
      ))}
    </section>
  );
}

export function Panel({
  title,
  meta,
  children,
  flush = false,
  className = "",
}: {
  title?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  return (
    <section className={`v2-panel ${className}`}>
      {(title || meta) && (
        <div className="v2-panel-head">
          <h2>{title}</h2>
          {meta && <span className="v2-panel-meta">{meta}</span>}
        </div>
      )}
      <div className={flush ? "v2-panel-body flush" : "v2-panel-body"}>{children}</div>
    </section>
  );
}
