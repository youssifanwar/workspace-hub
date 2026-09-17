"use client";

import { useState } from "react";

export default function PrintButton() {
  const [printing, setPrinting] = useState(false);

  function handlePrint() {
    if (printing) {
      return;
    }

    setPrinting(true);

    try {
      window.print();
    } finally {
      window.setTimeout(() => {
        setPrinting(false);
      }, 500);
    }
  }

  return (
    <button
      type="button"
      onClick={handlePrint}
      className="btn btn-ghost"
      disabled={printing}
      aria-label="Print shift summary"
    >
      🖨️ {printing ? "Preparing…" : "Print"}
    </button>
  );
}