import { useId } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function LogoMark({ className }: { className?: string }) {
  // Unique per instance: a shared gradient id breaks when the first copy sits in a hidden subtree.
  const gradientId = `ps-logo-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 512 512" className={cn("size-8", className)} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2563eb" />
          <stop offset="1" stopColor="#1e3a8a" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill={`url(#${gradientId})`} />
      <g fill="none" stroke="#fff" strokeWidth="30" strokeLinejoin="round" strokeLinecap="round">
        <path d="M168 200V120h176v80" />
        <rect x="112" y="200" width="288" height="144" rx="32" />
        <path d="M168 300h176v100H168z" fill="#1e3a8a" />
      </g>
      <circle cx="352" cy="252" r="16" fill="#fff" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight text-ink", className)}>
      <LogoMark />
      <span className="text-[17px]">PrintShare</span>
    </Link>
  );
}
