import Link from "next/link";
import { LogoMark } from "@/components/shared/logo";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-canvas px-6 text-center">
      <LogoMark className="size-12" />
      <p className="font-mono text-sm text-muted">404</p>
      <h1 className="text-2xl font-semibold tracking-tight">This page doesn&apos;t exist</h1>
      <p className="max-w-sm text-sm text-muted">The link may be old, or the document may have expired.</p>
      <Link href="/dashboard" className="mt-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white">
        Go to dashboard
      </Link>
    </main>
  );
}
