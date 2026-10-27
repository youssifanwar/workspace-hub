"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Friendly fallback for unexpected errors. It deliberately shows NO error
 * text, stack trace or internal detail to the user; the technical reason is
 * only written to the server/browser console with its reference id.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error", error.digest ?? "(no reference)");
  }, [error]);

  return (
    <div className="max-w-lg mx-auto card p-8 text-center mt-16" role="alert">
      <div className="text-5xl mb-3" aria-hidden="true">
        ⚠️
      </div>
      <h2 className="text-xl font-bold text-slate-900 mb-2">
        Something went wrong
      </h2>
      <p className="text-slate-500 mb-6">
        This page couldn&apos;t be loaded. Your data is safe. Try again, and if
        it keeps happening let your manager know.
        {error.digest && (
          <>
            <br />
            <span className="text-xs text-slate-400">
              Reference: {error.digest}
            </span>
          </>
        )}
      </p>
      <div className="flex justify-center gap-2">
        <button type="button" className="btn btn-primary" onClick={reset}>
          Try again
        </button>
        <Link href="/dashboard" className="btn btn-ghost">
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
