import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, CircleMinus, CircleX, Laptop, Smartphone, Usb } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Device compatibility",
  description: "What works on iPhone, Android and Windows with PrintShare, and why USB printers need the Windows bridge.",
};

type Row = { device: string; how: string; status: "yes" | "partial" | "no"; note: string };

const ROWS: Row[] = [
  { device: "iPhone / iPad — Safari", how: "Upload → PrintShare server → Windows bridge → USB", status: "yes", note: "Full support including PDF preview, live job status and Add to Home Screen." },
  { device: "iPhone / iPad — direct USB", how: "Safari to a USB printer", status: "no", note: "Safari has no access to USB devices. This is an iOS restriction, not a PrintShare one." },
  { device: "iPhone / iPad — AirPrint", how: "Native iOS print sheet", status: "partial", note: "Works only with AirPrint printers on the same Wi-Fi. The HP LaserJet M1005 is not an AirPrint printer." },
  { device: "Android — Chrome", how: "Upload → server → Windows bridge → USB", status: "yes", note: "Full support including installable app." },
  { device: "Android — USB OTG to the M1005", how: "Phone cable straight to the printer", status: "no", note: "The M1005 is host-based (no PCL/PostScript). Our companion app detects this and tells you to use the bridge." },
  { device: "Android — USB OTG to other printers", how: "Companion app", status: "partial", note: "The companion app reads the printer's IEEE 1284 ID. Printers that accept PCL can print directly (experimental)." },
  { device: "Windows / macOS — Chrome or Edge", how: "Upload → server → Windows bridge", status: "yes", note: "Full support. The bridge itself runs on Windows 10 and 11." },
];

const ICON = {
  yes: <CircleCheck className="size-5 text-success" aria-label="Supported" />,
  partial: <CircleMinus className="size-5 text-warning" aria-label="Partial" />,
  no: <CircleX className="size-5 text-danger" aria-label="Not possible" />,
};

export default function CompatibilityPage() {
  return (
    <div className="px-4 py-14 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-semibold text-accent">Compatibility</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">What works where — honestly</h1>
        <p className="mt-4 text-lg text-muted">
          The HP LaserJet MFP M1005 connects by USB only and has no Wi-Fi or AirPrint. Phones can&apos;t drive it directly, so PrintShare uses a small app on the Windows PC it&apos;s plugged into.
        </p>

        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          {[
            { icon: Smartphone, title: "Your phone", text: "Uploads over HTTPS from any modern browser." },
            { icon: Laptop, title: "Windows PC", text: "Runs PrintShare Bridge and the HP driver." },
            { icon: Usb, title: "M1005", text: "Connected to that PC with a USB cable." },
          ].map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
              <Icon className="size-6 text-accent" aria-hidden />
              <p className="mt-3 font-semibold">{title}</p>
              <p className="mt-1 text-sm text-muted">{text}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
          <ul className="divide-y divide-line">
            {ROWS.map((r) => (
              <li key={r.device} className="flex gap-4 p-5">
                <span className="mt-0.5 shrink-0">{ICON[r.status]}</span>
                <div className="min-w-0">
                  <p className="font-semibold">{r.device}</p>
                  <p className="text-sm text-ink-soft">{r.how}</p>
                  <p className="mt-1 text-sm text-muted">{r.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <h2 className="mt-14 text-xl font-semibold tracking-tight">When is a job “Completed”?</h2>
        <p className="mt-3 text-muted">
          Only after the Windows print spooler on the bridge PC reports that the job was printed, or that it finished sending every byte to the printer and removed it from the queue. The M1005&apos;s USB driver doesn&apos;t report individual sheets leaving the tray, so the spooler&apos;s confirmation is the strongest signal available — PrintShare never marks a job complete before that.
        </p>

        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/register">Get started</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href="/#faq">Read the FAQ</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
