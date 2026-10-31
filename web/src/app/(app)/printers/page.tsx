import type { Metadata } from "next";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PrintersPage } from "@/components/printers/printers-page";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Printers" };

const BRIDGE_PACKAGE = "downloads/PrintShareBridge-win-x64.zip";

export default function Page() {
  // BRIDGE_DOWNLOAD_URL (e.g. a release asset) wins; otherwise offer the package only if
  // bridge-windows/publish.ps1 actually placed it in public/ (self-hosted builds).
  const configured = env().BRIDGE_DOWNLOAD_URL;
  const local = existsSync(join(process.cwd(), "public", BRIDGE_PACKAGE)) ? `/${BRIDGE_PACKAGE}` : null;
  return <PrintersPage bridgeDownloadUrl={configured || local} />;
}
