"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import CheckInModal from "./CheckInModal";

export default function OpenSessionButton({
  currency,
}: {
  currency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function openModal() {
    setOpen(true);
  }

  function closeModal() {
    setOpen(false);
    router.refresh();
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="btn btn-primary"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        + Open Session
      </button>

      {open && (
        <CheckInModal
          currency={currency}
          onClose={closeModal}
        />
      )}
    </>
  );
}