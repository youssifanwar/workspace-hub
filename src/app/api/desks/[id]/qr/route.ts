import QRCode from "qrcode";
import { db } from "@/db";
import { desks } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { getPublicBaseUrl } from "@/lib/network";

export const dynamic = "force-dynamic";

/**
 * Returns a PNG QR code that encodes the public order URL for this desk.
 * Requires login (used from settings / print pages).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await params;
  const deskId = Number(id);
  const [desk] = await db
    .select()
    .from(desks)
    .where(eq(desks.id, deskId))
    .limit(1);
  if (!desk) return new Response("Not found", { status: 404 });

  const base = await getPublicBaseUrl();
  const url = `${base}/order/${desk.id}`;

  const png = await QRCode.toBuffer(url, {
    width: 512,
    margin: 1,
    color: { dark: "#0f172a", light: "#ffffff" },
    errorCorrectionLevel: "M",
  });

  return new Response(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}
