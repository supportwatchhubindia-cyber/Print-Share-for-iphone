import type { Metadata } from "next";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PrintersPage } from "@/components/printers/printers-page";

export const metadata: Metadata = { title: "Printers" };

const BRIDGE_PACKAGE = "downloads/PrintShareBridge-win-x64.zip";

export default function Page() {
  // Only advertise a download when bridge-windows/publish.ps1 has actually placed the package here.
  const available = existsSync(join(process.cwd(), "public", BRIDGE_PACKAGE));
  return <PrintersPage bridgeDownloadUrl={available ? `/${BRIDGE_PACKAGE}` : null} />;
}
