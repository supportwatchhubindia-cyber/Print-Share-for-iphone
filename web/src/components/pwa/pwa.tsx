"use client";

import * as React from "react";
import { Download, Share, SquarePlus, X } from "lucide-react";
import { Button } from "../ui/button";
import { isIOSDevice } from "@/lib/device";

/** Registers the service worker (secure contexts only: HTTPS or localhost). */
export function ServiceWorkerRegister() {
  React.useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => console.warn("[pwa] service worker registration failed", err));
  }, []);
  return null;
}

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const DISMISS_KEY = "printshare.install-dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** "Install app" card: native prompt on Android/desktop Chromium, instructions on iOS Safari. */
export function InstallPrompt() {
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = React.useState(false);
  const [hidden, setHidden] = React.useState(true);

  React.useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    if (standalone || readDismissed()) return;
    const isIos = isIOSDevice(navigator.userAgent, navigator.maxTouchPoints);
    setIos(isIos);
    if (isIos) setHidden(false);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      setHidden(false);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* private mode */
    }
  };

  if (hidden || (!ios && !deferred)) return null;

  return (
    <div className="relative flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Download className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 pr-6 text-sm">
        <p className="font-semibold text-ink">Install PrintShare</p>
        {ios ? (
          <p className="mt-0.5 text-muted">
            Tap <Share className="inline size-4 align-text-bottom" aria-label="Share" /> then{" "}
            <span className="whitespace-nowrap font-medium text-ink">
              <SquarePlus className="inline size-4 align-text-bottom" aria-hidden /> Add to Home Screen
            </span>{" "}
            for one-tap printing.
          </p>
        ) : (
          <>
            <p className="mt-0.5 text-muted">Add it to your home screen for one-tap printing.</p>
            <Button
              size="sm"
              className="mt-3"
              onClick={async () => {
                await deferred?.prompt();
                dismiss();
              }}
            >
              Install app
            </Button>
          </>
        )}
      </div>
      <button onClick={dismiss} className="absolute right-3 top-3 rounded-lg p-1 text-muted hover:bg-canvas hover:text-ink" aria-label="Dismiss">
        <X className="size-4" />
      </button>
    </div>
  );
}
