import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "WorkSpace Hub",
    template: "%s — WorkSpace Hub",
  },
  description:
    "Modern coworking space management system.",
  applicationName: "WorkSpace Hub",
  metadataBase: new URL(
    "http://localhost:3000",
  ),
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
    >
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}