"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted">The page hit an unexpected error. Your print jobs are not affected.</p>
      {error.digest && <p className="font-mono text-xs text-subtle">Reference {error.digest}</p>}
      <button onClick={reset} className="mt-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-medium text-white">
        Try again
      </button>
    </main>
  );
}
