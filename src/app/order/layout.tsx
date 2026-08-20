import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Order Menu",
  description: "Order food and drinks from your table.",
};

export default function OrderLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
