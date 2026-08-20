import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { ensureSeeded } from "@/lib/seed";

export const dynamic = "force-dynamic";

export default async function RootPage() {
  await ensureSeeded();
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect("/dashboard");
}
