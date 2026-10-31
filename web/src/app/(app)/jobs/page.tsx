import type { Metadata } from "next";
import { Suspense } from "react";
import { JobsPage } from "@/components/jobs/jobs-page";
import { Skeleton } from "@/components/ui/misc";

export const metadata: Metadata = { title: "Print jobs" };

export default function Page() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <JobsPage />
    </Suspense>
  );
}
