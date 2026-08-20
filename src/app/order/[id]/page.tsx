import PublicMenu from "./PublicMenu";

export const dynamic = "force-dynamic";

export default async function PublicOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const deskId = Number(id);
  return <PublicMenu deskId={deskId} />;
}
