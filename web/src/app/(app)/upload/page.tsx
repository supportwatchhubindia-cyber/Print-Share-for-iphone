import type { Metadata } from "next";
import { PageHeader } from "@/components/shared/states";
import { UploadManager } from "@/components/documents/upload-manager";
import { env } from "@/server/env";
import { findLibreOffice } from "@/server/documents/convert";

export const metadata: Metadata = { title: "Upload" };

export default function UploadPage() {
  return (
    <>
      <PageHeader title="Upload documents" description="PDFs print as-is. Photos, text and Office files are converted to print-ready PDFs." />
      <UploadManager maxUploadMb={env().MAX_UPLOAD_MB} officeAvailable={!!findLibreOffice()} />
    </>
  );
}
