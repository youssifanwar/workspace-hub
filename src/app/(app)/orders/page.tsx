import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSetting } from "@/lib/settings";
import OrdersBoard from "./OrdersBoard";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const currency = await getSetting("currency");
  const autoPrint = (await getSetting("auto_print_orders")) === "1";
  const kitchenPrinter = await getSetting("kitchen_printer_name");
  return (
    <OrdersBoard
      currency={currency}
      autoPrint={autoPrint}
      kitchenPrinter={kitchenPrinter}
    />
  );
}
