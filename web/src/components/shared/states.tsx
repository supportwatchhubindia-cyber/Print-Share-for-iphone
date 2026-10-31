import * as React from "react";
import { CircleAlert, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

export function EmptyState({ icon, title, description, action, className }: {
  icon: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-canvas/50 px-6 py-10 text-center", className)}>
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl bg-surface text-accent shadow-soft ring-1 ring-line [&_svg]:size-6">{icon}</div>
      <p className="font-semibold text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry, className }: { message: string; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-2xl border border-danger/20 bg-danger-soft p-4 sm:flex-row sm:items-center", className)}>
      <div className="flex flex-1 items-start gap-2.5 text-sm text-danger">
        <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{message}</span>
      </div>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted sm:text-[15px]">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Notice({ tone = "info", icon, title, children, className }: {
  tone?: "info" | "warning" | "danger" | "success";
  icon?: React.ReactNode;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const tones = {
    info: "border-accent/15 bg-accent-soft text-accent-ink",
    warning: "border-warning/20 bg-warning-soft text-warning",
    danger: "border-danger/20 bg-danger-soft text-danger",
    success: "border-success/20 bg-success-soft text-success",
  };
  return (
    <div className={cn("flex gap-3 rounded-2xl border p-4 text-sm", tones[tone], className)}>
      {icon && <div className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</div>}
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-ink-soft [&_a]:font-medium [&_a]:underline">{children}</div>}
      </div>
    </div>
  );
}
