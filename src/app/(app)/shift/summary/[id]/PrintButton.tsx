"use client";

import { useState } from "react";
import { useFmt } from "@/lib/lang-context";

export default function PrintButton() {
  const f = useFmt();
  const tx = f.t;
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
      aria-label={tx("Print shift summary")}
    >
      🖨️ {printing ? tx("Preparing…") : tx("Print")}
    </button>
  );
}