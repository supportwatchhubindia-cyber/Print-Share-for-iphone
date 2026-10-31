import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SystemPrint } from "@/components/documents/system-print";
import { getCurrentUser } from "@/server/auth/current";

export const metadata: Metadata = { title: "Print on this device", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await getCurrentUser())) redirect(`/login?next=${encodeURIComponent(`/airprint/${id}`)}`);
  return <SystemPrint id={id} />;
}
