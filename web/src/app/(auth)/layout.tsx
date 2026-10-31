import Link from "next/link";
import { Logo } from "@/components/shared/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="pt-safe px-5 py-4 sm:px-8">
        <Logo />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-6 sm:items-center sm:pt-0">
        <div className="w-full max-w-md">{children}</div>
      </main>
      <footer className="pb-safe px-5 py-6 text-center text-xs text-muted">
        <Link href="/compatibility" className="hover:text-ink">
          Device compatibility
        </Link>
        <span className="mx-2">·</span>
        <Link href="/#faq" className="hover:text-ink">
          FAQ
        </Link>
      </footer>
    </div>
  );
}
