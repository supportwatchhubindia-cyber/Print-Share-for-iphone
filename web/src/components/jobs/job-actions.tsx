"use client";

import * as React from "react";
import { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Ban, RotateCcw } from "lucide-react";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/dialog";
import { apiFetch, errorMessage } from "@/lib/api-client";
import type { PrintJobDTO } from "@/lib/types";

/** Cancel / Retry buttons with the server as the source of truth for what is allowed. */
export function JobActions({ job, size = "sm" }: { job: PrintJobDTO; size?: "sm" | "default" }) {
  const { mutate } = useSWRConfig();
  const [busy, setBusy] = React.useState<null | "cancel" | "retry">(null);
  const [confirm, setConfirm] = React.useState(false);
  const refresh = () => mutate((k) => typeof k === "string" && (k.includes("/api/print-jobs") || k.startsWith("/api/auth/me") || k.startsWith("/api/printers")));

  const act = async (kind: "cancel" | "retry") => {
    setBusy(kind);
    try {
      const { job: updated } = await apiFetch<{ job: PrintJobDTO }>(`/api/print-jobs/${job.id}/${kind}`, { method: "POST" });
      if (kind === "retry") toast.success("Job re-queued", { description: `Attempt ${updated.attempt}` });
      else toast.success(updated.status === "CANCELLED" ? "Job cancelled" : "Cancelling — waiting for the bridge to remove it from the Windows queue");
      await refresh();
      setConfirm(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {job.canRetry && (
        <Button size={size} variant="soft" loading={busy === "retry"} onClick={() => act("retry")}>
          <RotateCcw /> Retry
        </Button>
      )}
      {job.canCancel && (
        <Button size={size} variant="destructive-ghost" loading={busy === "cancel"} onClick={() => (job.status === "PRINTING" ? setConfirm(true) : act("cancel"))}>
          <Ban /> Cancel
        </Button>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Cancel a job that is printing?"
        description="The bridge will delete it from the Windows print queue. Pages already sent to the printer may still come out."
        confirmLabel="Cancel job"
        destructive
        loading={busy === "cancel"}
        onConfirm={() => act("cancel")}
      />
    </>
  );
}
