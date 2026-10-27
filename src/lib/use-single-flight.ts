"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Prevents double submissions: while an action is running, further calls
 * are ignored (the ref guards the gap before React re-renders, which a
 * plain `disabled={pending}` cannot).
 *
 *   const [run, pending] = useSingleFlight();
 *   <button disabled={pending} onClick={() => run(async () => { ... })} />
 */
export function useSingleFlight(): [
  <T>(action: () => Promise<T>) => Promise<T | undefined>,
  boolean,
] {
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
      if (inFlight.current) return undefined;
      inFlight.current = true;
      setPending(true);
      try {
        return await action();
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [],
  );

  return [run, pending];
}
