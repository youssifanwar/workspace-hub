import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings";

import OrdersBoard from "./OrdersBoard";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const [
    currency,
    autoPrintSetting,
    kitchenPrinter,
  ] = await Promise.all([
    getSetting("currency"),
    getSetting("auto_print_orders"),
    getSetting("kitchen_printer_name"),
  ]);

  const autoPrint =
    autoPrintSetting === "1";

  return (
    <OrdersBoard
      currency={currency}
      autoPrint={autoPrint}
      kitchenPrinter={kitchenPrinter}
    />
  );
}