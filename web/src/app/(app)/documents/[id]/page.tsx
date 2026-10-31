import type { Metadata } from "next";
import { DocumentPrintPage } from "@/components/documents/document-print-page";

export const metadata: Metadata = { title: "Print settings" };

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentPrintPage id={id} />;
}
