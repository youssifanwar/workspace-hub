import type { Metadata } from "next";
import type { ReactNode } from "react";

// Self-hosted fonts (no runtime request to Google). Fira Sans is the UI
// face, Fira Code is used for figures/codes, Noto Sans Arabic covers
// Arabic customer names and notes.
import "@fontsource/fira-sans/400.css";
import "@fontsource/fira-sans/500.css";
import "@fontsource/fira-sans/600.css";
import "@fontsource/fira-sans/700.css";
import "@fontsource/fira-code/500.css";
import "@fontsource-variable/noto-sans-arabic";

import "./globals.css";
import "./redesign.css";
import "./redesign-v2.css";
import { getLang } from "@/lib/i18n";
import { LangProvider } from "@/lib/lang-context";

export const metadata: Metadata = {
  title: {
    default: "WorkSpace Hub",
    template: "%s — WorkSpace Hub",
  },
  description:
    "Modern coworking space management system.",
  applicationName: "WorkSpace Hub",
  icons: { icon: "/icon.png", apple: "/apple-icon.png" },
  metadataBase: new URL(
    "http://localhost:3000",
  ),
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const lang = await getLang();
  return (
    <html
      lang={lang}
      dir={lang === "ar" ? "rtl" : "ltr"}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <LangProvider lang={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}