"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import CheckInModal from "./CheckInModal";
import { useFmt } from "@/lib/lang-context";

export default function OpenSessionButton({
  currency,
}: {
  currency: string;
}) {
  const f = useFmt();
  const tx = f.t;
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
        {tx("+ Open Session")}
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