import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { LogoMark } from "@/components/shared/logo";

export const metadata: Metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-6 text-center">
      <LogoMark className="size-12" />
      <div className="flex items-center gap-2 text-muted">
        <WifiOff className="size-5" aria-hidden />
        <span className="text-sm font-medium">You&apos;re offline</span>
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">PrintShare needs a connection</h1>
      <p className="max-w-sm text-sm text-muted">Uploading and printing go through the server. Reconnect to Wi-Fi or mobile data and try again — queued jobs keep their place.</p>
      <a href="/dashboard" className="mt-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white">
        Try again
      </a>
    </main>
  );
}
