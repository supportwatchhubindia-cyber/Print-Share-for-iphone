"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { SWRConfig } from "swr";
import { History, LayoutDashboard, LogOut, Printer, Settings, ShieldCheck, Upload, UserRound } from "lucide-react";
import { Logo } from "../shared/logo";
import { RealtimeProvider, useRealtimeStatus } from "../realtime/realtime-provider";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../ui/misc";
import { apiFetch, fetcher } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { UserDTO } from "@/lib/types";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean };

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/upload", label: "Upload", icon: Upload },
  { href: "/printers", label: "Printers", icon: Printer },
  { href: "/jobs", label: "Print jobs", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
  { href: "/admin", label: "Admin", icon: ShieldCheck, adminOnly: true },
];

const TABS: NavItem[] = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: History },
  { href: "/upload", label: "Print", icon: Upload },
  { href: "/printers", label: "Printers", icon: Printer },
  { href: "/settings", label: "Account", icon: UserRound },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`) || (href === "/upload" && pathname.startsWith("/documents"));
}

function LiveIndicator() {
  const status = useRealtimeStatus();
  const label = status === "live" ? "Live updates on" : status === "connecting" ? "Connecting…" : "Reconnecting…";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted" role="status">
      <span className={cn("size-2 rounded-full", status === "live" ? "bg-success" : "animate-pulse-soft bg-warning")} aria-hidden />
      {label}
    </span>
  );
}

function UserMenu({ user }: { user: UserDTO }) {
  const router = useRouter();
  const initials = user.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-xl p-1 pr-2 text-left transition-colors hover:bg-canvas" aria-label="Account menu">
        <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-ink">{initials}</span>
        <span className="hidden min-w-0 lg:block">
          <span className="block truncate text-sm font-medium text-ink">{user.name}</span>
          <span className="block truncate text-xs text-muted">{user.email}</span>
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>{user.email}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => router.push("/settings")}>
          <Settings /> Settings
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={async () => {
            await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
            window.location.assign("/login");
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ user, children }: { user: UserDTO; children: React.ReactNode }) {
  const pathname = usePathname();
  const nav = NAV.filter((n) => !n.adminOnly || user.role === "ADMIN");

  return (
    <SWRConfig value={{ fetcher, shouldRetryOnError: (err) => (err as { status?: number })?.status !== 401 }}>
      <RealtimeProvider>
        <div className="min-h-dvh bg-canvas lg:pl-64">
          {/* Desktop sidebar */}
          <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface lg:flex">
            <div className="flex h-16 items-center px-6">
              <Logo href="/dashboard" />
            </div>
            <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Main">
              {nav.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                      active ? "bg-accent-soft text-accent-ink" : "text-ink-soft hover:bg-canvas hover:text-ink",
                    )}
                  >
                    <Icon className={cn("size-[18px]", active ? "text-accent" : "text-muted")} />
                    {label}
                  </Link>
                );
              })}
            </nav>
            <div className="space-y-3 border-t border-line p-4">
              <LiveIndicator />
              <UserMenu user={user} />
            </div>
          </aside>

          {/* Mobile top bar */}
          <header className="pt-safe sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-xl lg:hidden">
            <div className="flex h-14 items-center justify-between px-4">
              <Logo href="/dashboard" />
              <div className="flex items-center gap-1">
                {user.role === "ADMIN" && (
                  <Link href="/admin" className="rounded-xl p-2 text-muted hover:bg-canvas" aria-label="Admin">
                    <ShieldCheck className="size-5" />
                  </Link>
                )}
                <UserMenu user={user} />
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 lg:px-10 lg:pb-12 lg:pt-10">{children}</main>

          {/* Mobile tab bar */}
          <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/90 backdrop-blur-xl lg:hidden" aria-label="Tabs">
            <div className="mx-auto grid max-w-md grid-cols-5">
              {TABS.map(({ href, label, icon: Icon }) => {
                const active = isActive(pathname, href);
                const primary = href === "/upload";
                return (
                  <Link key={href} href={href} aria-current={active ? "page" : undefined} className="flex flex-col items-center gap-0.5 pb-1.5 pt-2 text-[11px] font-medium">
                    <span
                      className={cn(
                        "flex items-center justify-center rounded-2xl transition-colors",
                        primary ? "size-10 -mt-1 bg-accent text-white shadow-card" : "size-7",
                        !primary && (active ? "text-accent" : "text-subtle"),
                      )}
                    >
                      <Icon className={primary ? "size-5" : "size-[22px]"} />
                    </span>
                    <span className={active ? "text-accent" : "text-muted"}>{label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>
      </RealtimeProvider>
    </SWRConfig>
  );
}
