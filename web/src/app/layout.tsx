import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { ServiceWorkerRegister } from "@/components/pwa/pwa";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "PrintShare — Print anything, from anywhere", template: "%s · PrintShare" },
  description:
    "Upload PDFs, photos and Office files from your iPhone, Android or computer and print them on your USB printer through the PrintShare Windows Bridge.",
  applicationName: "PrintShare",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "PrintShare", statusBarStyle: "default" },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/icons/icon.svg", type: "image/svg+xml" }],
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans">
        {children}
        <Toaster position="top-center" richColors closeButton toastOptions={{ className: "rounded-2xl" }} />
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
