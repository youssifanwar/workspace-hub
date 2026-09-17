import { asc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { db } from "@/db";
import {
  categories,
  products,
} from "@/db/schema";

import {
  canManage,
  getCurrentUser,
} from "@/lib/auth";

import { getSetting } from "@/lib/settings";

import MenuManager from "./MenuManager";

export const dynamic = "force-dynamic";

export default async function MenuPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  const manageMenu = canManage(user.role);

  const [currency, cats, prods] =
    await Promise.all([
      getSetting("currency"),

      db
        .select({
          id: categories.id,
          name: categories.name,
          icon: categories.icon,
        })
        .from(categories)
        .orderBy(
          asc(categories.sortOrder),
          asc(categories.id),
        ),

      db
        .select({
          id: products.id,
          categoryId: products.categoryId,
          name: products.name,
          price: products.price,
          imageUrl: products.imageUrl,
          icon: products.icon,
        })
        .from(products)
        .where(
          eq(
            products.active,
            true,
          ),
        )
        .orderBy(
          asc(products.name),
          asc(products.id),
        ),
    ]);

  const categoriesForManager =
    cats.map((category) => ({
      id: category.id,
      name: category.name,
      icon: category.icon,
    }));

  const productsForManager =
    prods.map((product) => ({
      id: product.id,
      categoryId: product.categoryId,
      name: product.name,
      price: product.price,
      imageUrl: product.imageUrl,
      icon: product.icon,
    }));

  return (
    <div className="space-y-6">
      {/* HEADER */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">
            Menu (Food &amp; Beverage)
          </h1>

          <p className="text-slate-500">
            {manageMenu
              ? "Manage categories and products. Click any card to edit."
              : "Browse the menu. Ask a manager to add or edit items."}
          </p>
        </div>
      </div>

      {/* MENU */}
      <MenuManager
        categories={categoriesForManager}
        products={productsForManager}
        currency={currency}
        canManage={manageMenu}
      />
    </div>
  );
}