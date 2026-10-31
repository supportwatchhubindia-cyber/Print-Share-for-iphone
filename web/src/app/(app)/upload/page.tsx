import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/states";
import { UploadManager } from "@/components/documents/upload-manager";
import { env, uploadMode } from "@/server/env";
import { officeConverter } from "@/server/documents/convert";
import { getCurrentUser } from "@/server/auth/current";

export const metadata: Metadata = { title: "Upload" };

export default async function UploadPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/upload");
  return (
    <>
      <PageHeader title="Upload documents" description="PDFs print as-is. Photos, text and Office files are converted to print-ready PDFs." />
      <UploadManager maxUploadMb={env().MAX_UPLOAD_MB} officeAvailable={!!officeConverter()} uploadMode={uploadMode()} userId={user.id} />
    </>
  );
}
