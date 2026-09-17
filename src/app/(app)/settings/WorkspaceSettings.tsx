"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type SettingsResponse = {
  error?: string;
};

export default function WorkspaceSettings({
  workspaceName,
  workspaceAddress,
  workspacePhone,
  currency,
  invoiceFooter,
}: {
  workspaceName: string;
  workspaceAddress: string;
  workspacePhone: string;
  currency: string;
  invoiceFooter: string;
}) {
  const router = useRouter();

  const [name, setName] = useState(workspaceName);
  const [address, setAddress] = useState(workspaceAddress);
  const [phone, setPhone] = useState(workspacePhone);
  const [cur, setCur] = useState(currency);
  const [footer, setFooter] = useState(invoiceFooter);

  const [loading, setLoading] = useState(false);

  const [msg, setMsg] = useState<{
    type: "ok" | "err";
    text: string;
  } | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (loading) {
      return;
    }

    setMsg(null);

    const normalizedName = name.trim();
    const normalizedAddress = address.trim();
    const normalizedPhone = phone.trim();
    const normalizedCurrency = cur.trim();
    const normalizedFooter = footer.trim();

    if (!normalizedName) {
      setMsg({
        type: "err",
        text: "Workspace name is required.",
      });
      return;
    }

    if (normalizedName.length > 200) {
      setMsg({
        type: "err",
        text: "Workspace name is too long.",
      });
      return;
    }

    if (normalizedAddress.length > 500) {
      setMsg({
        type: "err",
        text: "Address is too long.",
      });
      return;
    }

    if (normalizedPhone.length > 50) {
      setMsg({
        type: "err",
        text: "Phone number is too long.",
      });
      return;
    }

    if (!normalizedCurrency) {
      setMsg({
        type: "err",
        text: "Currency is required.",
      });
      return;
    }

    if (
      normalizedCurrency.length < 1 ||
      normalizedCurrency.length > 5
    ) {
      setMsg({
        type: "err",
        text: "Currency must be between 1 and 5 characters.",
      });
      return;
    }

    if (normalizedFooter.length > 500) {
      setMsg({
        type: "err",
        text: "Invoice footer is too long.",
      });
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          workspace_name: normalizedName,
          workspace_address: normalizedAddress,
          workspace_phone: normalizedPhone,
          currency: normalizedCurrency,
          invoice_footer: normalizedFooter,
        }),
      });

      const data = (await res.json().catch(() => null)) as
        | SettingsResponse
        | null;

      if (!res.ok) {
        setMsg({
          type: "err",
          text:
            data?.error ||
            "Failed to save workspace settings.",
        });
        return;
      }

      setName(normalizedName);
      setAddress(normalizedAddress);
      setPhone(normalizedPhone);
      setCur(normalizedCurrency);
      setFooter(normalizedFooter);

      setMsg({
        type: "ok",
        text: "Workspace settings saved ✓",
      });

      router.refresh();
    } catch (error) {
      console.error("Workspace settings update failed:", error);

      setMsg({
        type: "err",
        text:
          "Could not connect to the server. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3"
      noValidate
    >
      {/* WORKSPACE NAME */}
      <div>
        <label
          htmlFor="workspace-name"
          className="label"
        >
          Workspace name
        </label>

        <input
          id="workspace-name"
          name="workspace_name"
          className="input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setMsg(null);
          }}
          maxLength={200}
          autoComplete="organization"
          required
          disabled={loading}
        />
      </div>

      {/* PHONE + CURRENCY */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="workspace-phone"
            className="label"
          >
            Phone
          </label>

          <input
            id="workspace-phone"
            name="workspace_phone"
            className="input"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setMsg(null);
            }}
            maxLength={50}
            autoComplete="tel"
            disabled={loading}
          />
        </div>

        <div>
          <label
            htmlFor="workspace-currency"
            className="label"
          >
            Currency
          </label>

          <input
            id="workspace-currency"
            name="currency"
            className="input"
            value={cur}
            onChange={(e) => {
              setCur(e.target.value);
              setMsg(null);
            }}
            maxLength={5}
            required
            autoComplete="off"
            disabled={loading}
          />
        </div>
      </div>

      {/* ADDRESS */}
      <div>
        <label
          htmlFor="workspace-address"
          className="label"
        >
          Address
        </label>

        <input
          id="workspace-address"
          name="workspace_address"
          className="input"
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            setMsg(null);
          }}
          maxLength={500}
          autoComplete="street-address"
          disabled={loading}
        />
      </div>

      {/* INVOICE FOOTER */}
      <div>
        <label
          htmlFor="invoice-footer"
          className="label"
        >
          Invoice footer
        </label>

        <input
          id="invoice-footer"
          name="invoice_footer"
          className="input"
          value={footer}
          onChange={(e) => {
            setFooter(e.target.value);
            setMsg(null);
          }}
          maxLength={500}
          placeholder="Thank you for visiting!"
          disabled={loading}
        />
      </div>

      {/* MESSAGE */}
      {msg && (
        <div
          role="alert"
          aria-live="polite"
          className={`p-3 rounded-xl text-sm ${
            msg.type === "ok"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-100"
              : "bg-red-50 text-red-700 border border-red-100"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* SUBMIT */}
      <button
        type="submit"
        className="btn btn-primary w-full"
        disabled={loading}
        aria-busy={loading}
      >
        {loading
          ? "Saving…"
          : "Save workspace settings"}
      </button>
    </form>
  );
}