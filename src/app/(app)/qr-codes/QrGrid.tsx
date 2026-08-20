"use client";

import { useEffect, useState } from "react";

type Desk = {
  id: number;
  name: string;
  type: "desk" | "meeting_room";
};

type PrintState = {
  desks: Desk[];
  active: boolean;
};

export default function QrGrid({
  desks,
  baseUrl,
  workspaceName,
}: {
  desks: Desk[];
  baseUrl: string;
  workspaceName: string;
}) {
  const [selected, setSelected] =
    useState<Set<number>>(new Set());

  const [printState, setPrintState] =
    useState<PrintState>({
      desks: [],
      active: false,
    });

  // ---------------------------------------------------------------------------
  // SELECTION
  // ---------------------------------------------------------------------------

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  function selectAll() {
    setSelected(
      new Set(
        desks.map((d) => d.id),
      ),
    );
  }

  function selectNone() {
    setSelected(new Set());
  }

  // ---------------------------------------------------------------------------
  // PRINT
  // ---------------------------------------------------------------------------

  function printSelected() {
    const list = desks.filter((d) =>
      selected.has(d.id),
    );

    if (list.length === 0) {
      return;
    }

    startPrint(list);
  }

  function printOne(desk: Desk) {
    startPrint([desk]);
  }

  function startPrint(list: Desk[]) {
    if (list.length === 0) {
      return;
    }

    setPrintState({
      desks: list,
      active: true,
    });
  }

  // ---------------------------------------------------------------------------
  // WAIT FOR QR IMAGES THEN PRINT
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (
      !printState.active ||
      printState.desks.length === 0
    ) {
      return;
    }

    let cancelled = false;

    async function waitForImages() {
      const images = Array.from(
        document.querySelectorAll<HTMLImageElement>(
          ".qr-print-area img",
        ),
      );

      await Promise.all(
        images.map(
          (img) =>
            new Promise<void>((resolve) => {
              if (img.complete) {
                resolve();
                return;
              }

              const done = () => {
                img.removeEventListener(
                  "load",
                  done,
                );

                img.removeEventListener(
                  "error",
                  done,
                );

                resolve();
              };

              img.addEventListener(
                "load",
                done,
              );

              img.addEventListener(
                "error",
                done,
              );
            }),
        ),
      );

      // Give the browser/electron renderer a moment
      // to finish painting the images.
      await new Promise((resolve) =>
        setTimeout(resolve, 500),
      );

      if (cancelled) {
        return;
      }

      window.print();
    }

    waitForImages();

    return () => {
      cancelled = true;
    };
  }, [
    printState.active,
    printState.desks,
  ]);

  // ---------------------------------------------------------------------------
  // AFTER PRINT
  // ---------------------------------------------------------------------------

  useEffect(() => {
    function handleAfterPrint() {
      setPrintState({
        desks: [],
        active: false,
      });
    }

    window.addEventListener(
      "afterprint",
      handleAfterPrint,
    );

    return () => {
      window.removeEventListener(
        "afterprint",
        handleAfterPrint,
      );
    };
  }, []);

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------

  return (
    <>
      {/* ===================================================================== */}
      {/* NORMAL PAGE                                                           */}
      {/* ===================================================================== */}

      <div
        className={
          printState.active
            ? "screen-content"
            : ""
        }
      >
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={selectAll}
          >
            Select all
          </button>

          <button
            type="button"
            className="btn btn-ghost"
            onClick={selectNone}
          >
            Clear
          </button>

          <div className="ml-auto flex gap-2">
            <button
              type="button"
              className="btn btn-primary"
              onClick={printSelected}
              disabled={
                selected.size === 0 ||
                printState.active
              }
            >
              🖨 Print selected (
              {selected.size}
              )
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 mt-4">
          {desks.map((desk) => {
            const isSelected =
              selected.has(desk.id);

            return (
              <div
                key={desk.id}
                onClick={() =>
                  toggle(desk.id)
                }
                className={`card p-3 cursor-pointer transition ${
                  isSelected
                    ? "ring-2 ring-indigo-500 border-indigo-500"
                    : ""
                }`}
              >
                {/* QR */}
                <div className="aspect-square bg-white grid place-items-center overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/desks/${desk.id}/qr`}
                    alt={`QR ${desk.name}`}
                    className="w-full h-full object-contain"
                  />
                </div>

                {/* NAME */}
                <div className="text-center mt-2">
                  <div className="font-bold text-sm">
                    {desk.name}
                  </div>

                  <div className="text-[11px] text-slate-500">
                    {desk.type ===
                    "meeting_room"
                      ? "Meeting Room"
                      : "Desk"}
                  </div>
                </div>

                {/* PRINT ONE */}
                <button
                  type="button"
                  className="btn btn-ghost w-full mt-2 !py-1.5 text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    printOne(desk);
                  }}
                  disabled={
                    printState.active
                  }
                >
                  🖨 Print
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* PRINT AREA                                                            */}
      {/* ===================================================================== */}

      {printState.active && (
        <div className="qr-print-area">
          <div className="print-grid">
            {printState.desks.map(
              (desk) => (
                <div
                  className="print-card"
                  key={desk.id}
                >
                  <div className="print-brand">
                    {workspaceName}
                  </div>

                  <div className="print-title">
                    {desk.name}
                  </div>

                  <div className="print-type">
                    {desk.type ===
                    "meeting_room"
                      ? "Meeting Room"
                      : "Desk"}
                  </div>

                  <div className="print-qr">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/desks/${desk.id}/qr`}
                      alt={`QR ${desk.name}`}
                    />
                  </div>

                  <div className="print-cta">
                    📱 Scan to order
                  </div>

                  <div className="print-url">
                    {baseUrl}/order/{desk.id}
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* PRINT CSS                                                             */}
      {/* ===================================================================== */}

      <style jsx global>{`
        .qr-print-area {
          display: none;
        }

        @media print {
          @page {
            size: A4;
            margin: 8mm;
          }

          html,
          body {
            background: #fff !important;
            margin: 0 !important;
            padding: 0 !important;
          }

          body * {
            visibility: hidden !important;
          }

          .qr-print-area,
          .qr-print-area * {
            visibility: visible !important;
          }

          .screen-content {
            display: none !important;
          }

          .qr-print-area {
            display: block !important;
            position: static !important;
            width: 100% !important;
          }

          .print-grid {
            display: grid;
            grid-template-columns: repeat(
              2,
              minmax(0, 1fr)
            );
            gap: 8mm;
            width: 100%;
          }

          .print-card {
            box-sizing: border-box;
            width: 100%;
            min-height: 118mm;

            border: 2px dashed #cbd5e1;
            border-radius: 4mm;

            padding: 6mm 5mm;

            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-start;

            text-align: center;

            page-break-inside: avoid;
            break-inside: avoid;
          }

          .print-brand {
            font-family:
              "Segoe UI",
              system-ui,
              sans-serif;

            font-size: 10pt;
            font-weight: 600;

            color: #64748b;

            text-transform: uppercase;
            letter-spacing: 1px;

            margin-bottom: 2mm;
          }

          .print-title {
            font-family:
              "Segoe UI",
              system-ui,
              sans-serif;

            font-size: 22pt;
            line-height: 1.1;

            font-weight: 800;

            color: #0f172a;

            margin-bottom: 1.5mm;
          }

          .print-type {
            font-family:
              "Segoe UI",
              system-ui,
              sans-serif;

            font-size: 9pt;

            color: #64748b;

            margin-bottom: 4mm;
          }

          .print-qr {
            width: 62mm;
            height: 62mm;

            display: flex;
            align-items: center;
            justify-content: center;

            margin: 0 auto;
          }

          .print-qr img {
            width: 62mm !important;
            height: 62mm !important;

            display: block !important;

            object-fit: contain !important;
          }

          .print-cta {
            font-family:
              "Segoe UI",
              system-ui,
              sans-serif;

            margin-top: 4mm;

            font-size: 11pt;

            font-weight: 700;

            color: #111827;
          }

          .print-url {
            font-family:
              "Segoe UI",
              system-ui,
              sans-serif;

            margin-top: 2mm;

            max-width: 90%;

            font-size: 7.5pt;

            color: #64748b;

            word-break: break-all;
            line-height: 1.2;
          }
        }
      `}</style>
    </>
  );
}