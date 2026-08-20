import { db } from "@/db";
import { categories, products } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { getCurrentUser, canManage } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getSetting } from "@/lib/settings";
import MenuManager from "./MenuManager";

export const dynamic = "force-dynamic";

export default async function MenuPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const currency = await getSetting("currency");

  const cats = await db
    .select()
    .from(categories)
    .orderBy(asc(categories.sortOrder));
  const prods = await db
    .select()
    .from(products)
    .where(eq(products.active, true))
    .orderBy(asc(products.name));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Menu (Food & Beverage)</h1>
          <p className="text-slate-500">
            {canManage(user.role)
              ? "Manage categories and products. Click any card to edit."
              : "Browse the menu. Ask a manager to add or edit items."}
          </p>
        </div>
      </div>

      <MenuManager
        categories={cats.map((c) => ({
          id: c.id,
          name: c.name,
          icon: c.icon,
        }))}
        products={prods.map((p) => ({
          id: p.id,
          categoryId: p.categoryId,
          name: p.name,
          price: p.price,
          imageUrl: p.imageUrl,
          icon: p.icon,
        }))}
        currency={currency}
        canManage={canManage(user.role)}
      />
    </div>
  );
}
