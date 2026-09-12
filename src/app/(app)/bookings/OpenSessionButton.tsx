"use client";

import { useState } from "react";
import CheckInModal from "./CheckInModal";

export default function OpenSessionButton({
  currency,
}: {
  currency: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn btn-primary"
      >
        + Open Session
      </button>

      {open && (
        <div className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-[420px]">
            <CheckInModal
              currency={currency}
              onClose={() => {
                setOpen(false);
                window.location.reload();
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}