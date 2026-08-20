import { db } from "@/db";
import { users, desks, categories, products, settings } from "@/db/schema";
import { hashPassword } from "@/lib/auth";

let seededPromise: Promise<void> | null = null;

export async function ensureSeeded(): Promise<void> {
  if (seededPromise) return seededPromise;
  seededPromise = (async () => {
    // Users
    const existingUsers = await db.select({ id: users.id }).from(users).limit(1);
    if (existingUsers.length === 0) {
      await db.insert(users).values([
        {
          username: "admin",
          passwordHash: hashPassword("admin123"),
          fullName: "System Administrator",
          role: "admin",
        },
        {
          username: "manager",
          passwordHash: hashPassword("manager123"),
          fullName: "Floor Manager",
          role: "manager",
        },
        {
          username: "employee",
          passwordHash: hashPassword("employee123"),
          fullName: "Front Desk Employee",
          role: "employee",
        },
      ]);
    }

    // Desks and meeting rooms
    const existingDesks = await db.select({ id: desks.id }).from(desks).limit(1);
    if (existingDesks.length === 0) {
      const deskRows = Array.from({ length: 12 }, (_, i) => ({
        name: `Desk ${i + 1}`,
        type: "desk" as const,
        hourlyRate: "25.00",
        sortOrder: i,
      }));
      const meetingRows = [
        {
          name: "Meeting Room 1",
          type: "meeting_room" as const,
          hourlyRate: "150.00",
          sortOrder: 100,
        },
        {
          name: "Meeting Room 2",
          type: "meeting_room" as const,
          hourlyRate: "180.00",
          sortOrder: 101,
        },
        {
          name: "Meeting Room 3",
          type: "meeting_room" as const,
          hourlyRate: "200.00",
          sortOrder: 102,
        },
      ];
      await db.insert(desks).values([...deskRows, ...meetingRows]);
    }

    // Categories & products
    const existingCategories = await db
      .select({ id: categories.id })
      .from(categories)
      .limit(1);
    if (existingCategories.length === 0) {
      const inserted = await db
        .insert(categories)
        .values([
          { name: "Hot Drinks", icon: "☕", sortOrder: 1 },
          { name: "Cold Drinks", icon: "🧊", sortOrder: 2 },
          { name: "Snacks", icon: "🍪", sortOrder: 3 },
          { name: "Meals", icon: "🍔", sortOrder: 4 },
        ])
        .returning();
      const [hot, cold, snacks, meals] = inserted;
      await db.insert(products).values([
        {
          categoryId: hot.id,
          name: "Espresso",
          price: "30.00",
          icon: "☕",
          imageUrl:
            "https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?w=400",
        },
        {
          categoryId: hot.id,
          name: "Cappuccino",
          price: "45.00",
          icon: "☕",
          imageUrl:
            "https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400",
        },
        {
          categoryId: hot.id,
          name: "Latte",
          price: "50.00",
          icon: "🥛",
          imageUrl:
            "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400",
        },
        {
          categoryId: hot.id,
          name: "Green Tea",
          price: "25.00",
          icon: "🍵",
          imageUrl:
            "https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=400",
        },
        {
          categoryId: cold.id,
          name: "Iced Coffee",
          price: "55.00",
          icon: "🧊",
          imageUrl:
            "https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=400",
        },
        {
          categoryId: cold.id,
          name: "Fresh Orange",
          price: "40.00",
          icon: "🍊",
          imageUrl:
            "https://images.unsplash.com/photo-1613478223719-2ab802602423?w=400",
        },
        {
          categoryId: cold.id,
          name: "Water",
          price: "10.00",
          icon: "💧",
          imageUrl:
            "https://images.unsplash.com/photo-1548839140-29a749e1cf4d?w=400",
        },
        {
          categoryId: snacks.id,
          name: "Chocolate Muffin",
          price: "35.00",
          icon: "🧁",
          imageUrl:
            "https://images.unsplash.com/photo-1607958996333-41aef7caefaa?w=400",
        },
        {
          categoryId: snacks.id,
          name: "Croissant",
          price: "30.00",
          icon: "🥐",
          imageUrl:
            "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=400",
        },
        {
          categoryId: meals.id,
          name: "Club Sandwich",
          price: "95.00",
          icon: "🥪",
          imageUrl:
            "https://images.unsplash.com/photo-1567234669003-dce7a7a88821?w=400",
        },
        {
          categoryId: meals.id,
          name: "Chicken Burger",
          price: "120.00",
          icon: "🍔",
          imageUrl:
            "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400",
        },
      ]);
    }

    // Settings defaults
    const existingSettings = await db
      .select({ key: settings.key })
      .from(settings)
      .limit(1);
    if (existingSettings.length === 0) {
      await db.insert(settings).values([
        { key: "workspace_name", value: "WorkSpace Hub" },
        { key: "workspace_address", value: "Cairo, Egypt" },
        { key: "workspace_phone", value: "+20 100 000 0000" },
        { key: "currency", value: "EGP" },
        {
          key: "invoice_footer",
          value: "Thank you for visiting! نتشرف بزيارتكم مرة أخرى",
        },
      ]);
    }
  })();
  return seededPromise;
}
