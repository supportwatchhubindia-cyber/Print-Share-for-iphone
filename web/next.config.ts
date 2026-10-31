import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Serverless hosts (Vercel) can't hold WebSockets: the UI polls instead. Decided at build time.
const realtimeTransport = process.env.REALTIME_TRANSPORT ?? (process.env.VERCEL ? "poll" : "websocket");
// Vercel Blob: browsers upload to vercel.com/api/blob and read presigned URLs on *.blob.vercel-storage.com.
const usesBlob = !!(process.env.VERCEL || process.env.BLOB_READ_WRITE_TOKEN || process.env.STORAGE_DRIVER === "vercel-blob");
const blobOrigins = usesBlob ? " https://vercel.com https://*.blob.vercel-storage.com" : "";

// PDF.js is served from /public/pdfjs as an ES module + worker (see scripts/copy-pdfjs.mjs).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ws: wss:${blobOrigins}`,
  "worker-src 'self' blob:",
  `frame-src 'self' blob:${blobOrigins}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), usb=()" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
  serverExternalPackages: ["sharp", "@node-rs/argon2", "pg"],
  env: { NEXT_PUBLIC_REALTIME_TRANSPORT: realtimeTransport },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
};

export default nextConfig;
