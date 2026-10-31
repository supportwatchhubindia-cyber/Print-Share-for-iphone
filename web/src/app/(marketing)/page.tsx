import Link from "next/link";
import {
  ArrowRight,
  Check,
  CircleCheck,
  CloudUpload,
  FileImage,
  FileSpreadsheet,
  FileText,
  KeyRound,
  Laptop,
  Lock,
  Presentation,
  Printer,
  ShieldCheck,
  Smartphone,
  Timer,
  Usb,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PLANS, formatPrice } from "@/lib/plans";
import { HP_LJ_M1005 } from "@/lib/printing/models";
import { SUBSCRIPTION_PLANS } from "@/lib/constants";
import { cn } from "@/lib/utils";

function Section({ id, eyebrow, title, intro, children, className }: { id?: string; eyebrow: string; title: string; intro?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cn("scroll-mt-20 px-4 py-20 sm:px-6 sm:py-24", className)}>
      <div className="mx-auto max-w-6xl">
        <p className="text-sm font-semibold text-accent">{eyebrow}</p>
        <h2 className="mt-2 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
        {intro && <p className="mt-4 max-w-2xl text-base text-muted sm:text-lg">{intro}</p>}
        <div className="mt-12">{children}</div>
      </div>
    </section>
  );
}

function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden>
      <div className="absolute -inset-8 -z-10 rounded-[3rem] bg-gradient-to-br from-accent-soft via-white to-white blur-2xl" />
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {/* Phone */}
        <div className="rounded-[2.2rem] border border-line bg-surface p-2.5 shadow-lift">
          <div className="rounded-[1.7rem] bg-canvas p-3">
            <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-line-strong" />
            <div className="rounded-2xl bg-surface p-3 shadow-soft">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-[#fdecec] text-[#b42318]">
                  <FileText className="size-4" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-semibold">Invoice-October.pdf</p>
                  <p className="text-[10px] text-muted">3 pages · 412 KB</p>
                </div>
              </div>
              <div className="mt-3 space-y-1.5 text-[10px]">
                {["HP LaserJet M1005", "2 copies · A4", "Black & white"].map((t) => (
                  <div key={t} className="flex items-center justify-between rounded-md bg-canvas px-2 py-1.5">
                    <span className="text-ink-soft">{t}</span>
                    <Check className="size-3 text-accent" />
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-lg bg-accent py-1.5 text-center text-[11px] font-semibold text-white">Print 6 pages</div>
            </div>
          </div>
        </div>
        {/* Flow */}
        <div className="flex flex-col items-center gap-2 text-subtle">
          <span className="h-10 w-px border-l-2 border-dashed border-line-strong" />
          <span className="flex size-9 items-center justify-center rounded-full bg-surface shadow-card ring-1 ring-line">
            <Lock className="size-4 text-accent" />
          </span>
          <span className="h-10 w-px border-l-2 border-dashed border-line-strong" />
        </div>
        {/* PC + printer */}
        <div className="space-y-3">
          <div className="rounded-2xl border border-line bg-surface p-3 shadow-card">
            <div className="flex items-center gap-2">
              <Laptop className="size-4 text-ink-soft" />
              <span className="text-[11px] font-semibold">Windows Bridge</span>
              <span className="ml-auto size-2 rounded-full bg-success" />
            </div>
            <p className="mt-1 text-[10px] text-muted">Spooler job #42 · printing</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-canvas">
              <div className="h-full w-2/3 rounded-full bg-accent" />
            </div>
          </div>
          <div className="flex items-center justify-center gap-1.5 text-[10px] font-medium text-muted">
            <Usb className="size-3.5" /> USB 2.0
          </div>
          <div className="rounded-2xl border border-line bg-surface p-3 shadow-card">
            <div className="mx-auto h-3 w-3/4 rounded-t-md bg-line" />
            <div className="flex h-12 items-center justify-center rounded-xl bg-ink text-white">
              <Printer className="size-6" />
            </div>
            <div className="mx-auto h-4 w-2/3 rounded-b-md border border-t-0 border-line bg-white" />
            <p className="mt-2 text-center text-[10px] font-semibold">HP LaserJet MFP M1005</p>
          </div>
        </div>
      </div>
    </div>
  );
}

const FORMATS = [
  { ext: "PDF", icon: FileText, note: "Printed exactly as-is" },
  { ext: "JPG · PNG", icon: FileImage, note: "Photos auto-rotated and fitted" },
  { ext: "DOCX", icon: FileText, note: "Converted with LibreOffice" },
  { ext: "XLSX", icon: FileSpreadsheet, note: "Each sheet paginated" },
  { ext: "PPTX", icon: Presentation, note: "One slide per page" },
  { ext: "TXT", icon: FileText, note: "Monospaced, wrapped to A4" },
];

const FAQ = [
  {
    q: "Can my iPhone print directly to a USB printer?",
    a: "No. Safari on iPhone has no access to USB printers, and the HP LaserJet M1005 has no Wi-Fi or AirPrint. PrintShare sends your document securely to the Windows PC the printer is plugged into, and the PrintShare Bridge prints it with the HP driver.",
  },
  {
    q: "Does it work on Android without a computer?",
    a: "Not for the M1005. It is a host-based printer: it doesn't understand PCL or PostScript, so the computer's driver must render every page into the printer's own format — something Android doesn't provide for this model. Our Android companion app checks any USB printer you connect and tells you whether direct printing is possible. For the M1005 you need the Windows bridge.",
  },
  {
    q: "How do I know the page actually printed?",
    a: "A job only shows “Completed” after the Windows print spooler confirms it was printed or fully delivered to the printer. If the printer runs out of paper you'll see that live, and the job carries on once you refill it.",
  },
  {
    q: "Is my document kept?",
    a: "Documents are stored privately, reachable only through short-lived signed links, and deleted automatically after 24 hours by default. The bridge checks every download's SHA-256 fingerprint before printing.",
  },
  {
    q: "Do I need to open ports on my router?",
    a: "No. The bridge makes outbound HTTPS and WebSocket connections to PrintShare. Nothing on your network listens for print jobs from the internet.",
  },
  {
    q: "Can I print in colour or double-sided?",
    a: "Only if your printer supports it. The M1005 is a monochrome, single-sided printer, so PrintShare never offers colour or duplex for it. Options always come from your printer's installed driver.",
  },
];

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden px-4 pb-20 pt-12 sm:px-6 sm:pt-20">
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-2">
          <div>
            <Badge tone="accent" className="mb-5">
              <Usb /> Built for the HP LaserJet MFP M1005
            </Badge>
            <h1 className="text-[2.6rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Print Anything.
              <br />
              <span className="text-accent">From Anywhere.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg text-muted">
              Upload a PDF, photo or Office file from your iPhone or Android and it prints on the USB printer at home or in the office — through a small, secure app on your Windows PC.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/upload">
                  <CloudUpload /> Upload & print
                </Link>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="#how-it-works">
                  How it works <ArrowRight />
                </Link>
              </Button>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              {["iPhone Safari", "Android Chrome", "Desktop Chrome & Edge", "Installable app"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <CircleCheck className="size-4 text-accent" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <HeroVisual />
        </div>
      </section>

      {/* Formats */}
      <Section eyebrow="Supported files" title="Send what you have. We make it printable." intro="Everything is converted to a print-ready PDF on the server, so the page you preview is the page that prints." className="bg-canvas">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {FORMATS.map(({ ext, icon: Icon, note }) => (
            <div key={ext} className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
              <Icon className="size-6 text-accent" aria-hidden />
              <p className="mt-4 font-semibold">{ext}</p>
              <p className="mt-1 text-xs text-muted">{note}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* How it works */}
      <Section id="how-it-works" eyebrow="How it works" title="Four steps from phone to paper" intro="Browsers can't talk to USB printers, so PrintShare puts a small bridge on the computer that can.">
        <ol className="grid gap-4 md:grid-cols-4">
          {[
            { icon: Laptop, title: "Install the bridge", text: "Install the HP driver and PrintShare Bridge on the Windows PC your printer is plugged into." },
            { icon: KeyRound, title: "Pair once", text: "Enter the one-time code from your dashboard. The bridge gets its own encrypted credentials." },
            { icon: Smartphone, title: "Upload from your phone", text: "Pick a file, preview every page, choose copies, pages and paper size." },
            { icon: Printer, title: "It prints", text: "The bridge downloads the job over HTTPS, verifies it and prints. You see live status." },
          ].map(({ icon: Icon, title, text }, i) => (
            <li key={title} className="rounded-2xl border border-line bg-surface p-6 shadow-card">
              <div className="flex items-center justify-between">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="font-mono text-sm text-subtle">0{i + 1}</span>
              </div>
              <p className="mt-5 font-semibold">{title}</p>
              <p className="mt-1.5 text-sm text-muted">{text}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            { icon: Lock, text: "TLS everywhere, signed download links, per-device credentials" },
            { icon: Wifi, text: "No open ports — the bridge only connects outward" },
            { icon: Timer, text: "Documents auto-delete after 24 hours" },
          ].map(({ icon: Icon, text }) => (
            <div key={text} className="flex items-center gap-3 rounded-2xl bg-canvas p-4 text-sm text-ink-soft ring-1 ring-inset ring-line">
              <Icon className="size-5 shrink-0 text-accent" aria-hidden />
              {text}
            </div>
          ))}
        </div>
      </Section>

      {/* Printers */}
      <Section id="printers" eyebrow="Supported printers" title="Designed around one printer. Ready for more." className="bg-canvas">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-accent/30 bg-surface p-6 shadow-card ring-4 ring-accent/5 lg:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-lg font-semibold">{HP_LJ_M1005.displayName}</p>
              <Badge tone="accent">Primary target</Badge>
              <Badge tone="neutral">Hardware verification pending</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">USB 2.0 · monochrome laser · via PrintShare Bridge on Windows</p>
            <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              {[
                ["Connection", "USB to a Windows PC"],
                ["Colour", "Black & white"],
                ["Sides", "Single-sided"],
                ["Paper", "A4, A5, Letter, Legal"],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted">{k}</dt>
                  <dd className="mt-0.5 font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 text-xs text-muted">
              The M1005 is host-based (no PCL or PostScript): pages are rendered for it by HP&apos;s installed Windows driver on the bridge PC, which is the path PrintShare uses.
            </p>
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
              <p className="font-semibold">Other Windows printers</p>
              <p className="mt-1 text-sm text-muted">Any printer installed on the bridge PC. Options are limited to what its driver reports.</p>
            </div>
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-soft">
              <p className="font-semibold">AirPrint printers</p>
              <p className="mt-1 text-sm text-muted">From iPhone you can also open the native print sheet for AirPrint printers on the same Wi-Fi.</p>
            </div>
          </div>
        </div>
      </Section>

      {/* Pricing */}
      <Section id="pricing" eyebrow="Pricing" title="Simple plans, priced per month">
        <div className="grid gap-4 lg:grid-cols-3">
          {SUBSCRIPTION_PLANS.map((id) => {
            const plan = PLANS[id];
            return (
              <div key={id} className={cn("flex flex-col rounded-3xl border bg-surface p-7", plan.highlighted ? "border-accent shadow-lift ring-4 ring-accent/10" : "border-line shadow-card")}>
                <div className="flex items-center justify-between">
                  <p className="text-lg font-semibold">{plan.name}</p>
                  {plan.highlighted && <Badge tone="accent">Most popular</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted">{plan.tagline}</p>
                <p className="mt-6">
                  <span className="text-4xl font-semibold tracking-tight">{formatPrice(plan)}</span>
                  {plan.priceMonthly > 0 && <span className="text-sm text-muted"> / month</span>}
                </p>
                <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-8" variant={plan.highlighted ? "default" : "secondary"} size="lg">
                  <Link href="/register">{plan.priceMonthly === 0 ? "Start free" : `Choose ${plan.name}`}</Link>
                </Button>
              </div>
            );
          })}
        </div>
      </Section>

      {/* FAQ */}
      <Section id="faq" eyebrow="FAQ" title="Straight answers" className="bg-canvas">
        <div className="mx-auto max-w-3xl divide-y divide-line rounded-3xl border border-line bg-surface px-6 shadow-card">
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                {q}
                <span className="text-xl text-muted transition-transform group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted">{a}</p>
            </details>
          ))}
        </div>
      </Section>

      {/* CTA */}
      <section className="px-4 py-20 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 rounded-[2rem] bg-ink px-6 py-14 text-center text-white sm:py-16">
          <ShieldCheck className="size-10 text-[#93b4ff]" aria-hidden />
          <h2 className="max-w-xl text-3xl font-semibold tracking-tight">Your printer, reachable from your pocket.</h2>
          <p className="max-w-lg text-white/70">Create an account, pair your Windows PC and print your first page in a few minutes.</p>
          <Button asChild size="lg" className="bg-white text-ink hover:bg-white/90">
            <Link href="/register">Get started free</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
