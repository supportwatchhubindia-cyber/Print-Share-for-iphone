import { File, FileImage, FileSpreadsheet, FileText, Presentation } from "lucide-react";
import { cn } from "@/lib/utils";

export function FileIcon({ ext, className }: { ext: string; className?: string }) {
  const e = ext.toLowerCase();
  const Icon =
    e === "jpg" || e === "jpeg" || e === "png" ? FileImage : e === "xlsx" ? FileSpreadsheet : e === "pptx" ? Presentation : e ? FileText : File;
  const tint =
    e === "pdf"
      ? "bg-[#fdecec] text-[#b42318]"
      : e === "docx"
        ? "bg-accent-soft text-accent"
        : e === "xlsx"
          ? "bg-success-soft text-success"
          : e === "pptx"
            ? "bg-warning-soft text-warning"
            : e === "jpg" || e === "jpeg" || e === "png"
              ? "bg-[#f3efff] text-[#6941c6]"
              : "bg-canvas text-muted";
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-xl", tint, className)}>
      <Icon className="size-5" aria-hidden />
    </span>
  );
}
