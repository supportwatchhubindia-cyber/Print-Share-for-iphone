"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Day = { date: string; pages: number };

const fmtDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Single-series column chart of pages printed per day.
 * One hue (accent), ≤24px columns with 4px rounded tops anchored to the baseline,
 * recessive axis, per-column hover/focus tooltip, and a screen-reader table.
 */
export function UsageChart({ days, className }: { days: Day[]; className?: string }) {
  const [active, setActive] = React.useState<number | null>(null);
  const max = Math.max(...days.map((d) => d.pages), 0);
  const scaleMax = max === 0 ? 1 : niceCeil(max);
  const total = days.reduce((s, d) => s + d.pages, 0);
  const labelIdx = new Set([0, Math.floor((days.length - 1) / 2), days.length - 1]);

  return (
    <figure className={cn("w-full", className)}>
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2" aria-hidden>
          <span className="text-[11px] tabular-nums text-subtle">{scaleMax}</span>
          <span className="h-px flex-1 border-t border-dashed border-line" />
        </div>
        <div className="flex h-36 items-end border-b border-line-strong pt-5" onMouseLeave={() => setActive(null)}>
          {days.map((d, i) => {
            const h = (d.pages / scaleMax) * 100;
            const isActive = active === i;
            return (
              <button
                key={d.date}
                type="button"
                className="group relative flex h-full flex-1 items-end justify-center px-[1px] focus-visible:outline-none"
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                aria-label={`${fmtDay(d.date)}: ${d.pages} page${d.pages === 1 ? "" : "s"}`}
              >
                {d.pages > 0 && (
                  <span
                    className={cn("block w-full max-w-6 rounded-t-[4px] bg-accent transition-opacity", active !== null && !isActive && "opacity-40")}
                    style={{ height: `${Math.max(h, 2)}%` }}
                  />
                )}
                {isActive && (
                  <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg bg-ink px-2 py-1 text-xs text-white shadow-lift">
                    <span className="text-white/70">{fmtDay(d.date)} · </span>
                    <span className="font-semibold tabular-nums">{d.pages}</span> {d.pages === 1 ? "page" : "pages"}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 flex text-[11px] text-subtle" aria-hidden>
          {days.map((d, i) => (
            <span key={d.date} className={cn("flex-1 text-center", !labelIdx.has(i) && "invisible")}>
              {fmtDay(d.date)}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="sr-only">
        Pages printed per day over the last {days.length} days, {total} in total.
      </figcaption>
      <table className="sr-only">
        <thead>
          <tr>
            <th>Date</th>
            <th>Pages</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.date}>
              <td>{fmtDay(d.date)}</td>
              <td>{d.pages}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

function niceCeil(n: number): number {
  const pow = 10 ** Math.floor(Math.log10(n));
  for (const step of [1, 2, 2.5, 5, 10]) if (n <= step * pow) return step * pow;
  return 10 * pow;
}
