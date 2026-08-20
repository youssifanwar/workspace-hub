"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

declare global {
  interface Window {
    wsh?: {
      silentPrint?: (opts: {
        html: string;
        printerName?: string;
        copies?: number;
      }) => Promise<{ ok: boolean; error?: string }>;
      listPrinters?: () => Promise<string[]>;
    };
  }
}

export default function PrintingSettings({
  autoPrint,
  kitchenPrinter,
  invoicePrinter,
}: {
  autoPrint: boolean;
  kitchenPrinter: string;
  invoicePrinter: string;
}) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(autoPrint);
  const [kitchen, setKitchen] = useState(kitchenPrinter);
  const [invoice, setInvoice] = useState(invoicePrinter);
  const [printers, setPrinters] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const inElectron =
    typeof window !== "undefined" && !!window.wsh?.listPrinters;

  useEffect(() => {
    (async () => {
      if (inElectron && window.wsh?.listPrinters) {
        try {
          const list = await window.wsh.listPrinters();
          setPrinters(list);
        } catch {
          setPrinters([]);
        }
      }
    })();
  }, [inElectron]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        auto_print_orders: enabled ? "1" : "0",
        kitchen_printer_name: kitchen,
        invoice_printer_name: invoice,
      }),
    });
    setLoading(false);
    if (!res.ok) {
      setMsg({ type: "err", text: "Failed to save" });
      return;
    }
    setMsg({ type: "ok", text: "Saved ✓" });
    router.refresh();
  }

  async function testPrint() {
    if (!window.wsh?.silentPrint) {
      alert(
        "Silent printing is only available in the desktop app.\nIn the browser, use Ctrl+P to print manually.",
      );
      return;
    }
    const html = `<!doctype html><html><body style="font-family:monospace;padding:8mm;">
      <h2 style="text-align:center;margin:0">TEST PRINT</h2>
      <p style="text-align:center">${new Date().toLocaleString()}</p>
      <p style="text-align:center">Printer: ${kitchen || "default"}</p>
    </body></html>`;
    const res = await window.wsh.silentPrint({
      html,
      printerName: kitchen || undefined,
    });
    setMsg(
      res.ok
        ? { type: "ok", text: "Test sent to printer ✓" }
        : { type: "err", text: res.error || "Print failed" },
    );
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="w-5 h-5"
        />
        <div>
          <div className="font-semibold text-sm">
            Auto-print new QR orders
          </div>
          <div className="text-xs text-slate-500">
            When ON, incoming orders print automatically on the kitchen printer
            (desktop app only).
          </div>
        </div>
      </label>

      <div className="grid md:grid-cols-2 gap-3">
        <PrinterField
          label="Kitchen printer (order tickets)"
          value={kitchen}
          onChange={setKitchen}
          printers={printers}
          inElectron={inElectron}
        />
        <PrinterField
          label="Invoice printer (customer receipts)"
          value={invoice}
          onChange={setInvoice}
          printers={printers}
          inElectron={inElectron}
        />
      </div>

      {!inElectron && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
          💡 Silent printing requires the desktop version of WorkSpace Hub.
          In the browser, the system will fall back to Ctrl+P dialog.
        </div>
      )}

      {msg && (
        <div
          className={`p-3 rounded-xl text-sm ${
            msg.type === "ok"
              ? "bg-emerald-50 text-emerald-800"
              : "bg-red-50 text-red-700"
          }`}
        >
          {msg.text}
        </div>
      )}

      <div className="flex gap-2">
        <button type="submit" className="btn btn-primary flex-1" disabled={loading}>
          {loading ? "Saving…" : "Save printing settings"}
        </button>
        <button
          type="button"
          onClick={testPrint}
          className="btn btn-ghost"
          disabled={!inElectron}
        >
          🧪 Test print
        </button>
      </div>
    </form>
  );
}

function PrinterField({
  label,
  value,
  onChange,
  printers,
  inElectron,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  printers: string[] | null;
  inElectron: boolean;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {inElectron && printers ? (
        <select
          className="select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— System default —</option>
          {printers.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      ) : (
        <input
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Exact printer name from Windows"
        />
      )}
    </div>
  );
}
