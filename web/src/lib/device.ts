/** Human label for a session, e.g. "iPhone · Safari". */
export function describeUserAgent(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  if (/PrintShare-Bridge/i.test(ua)) return "Windows Bridge";
  if (/PrintShare-Android/i.test(ua)) return "Android companion";
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /Linux/.test(ua)
              ? "Linux"
              : "Device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /CriOS|Chrome\//.test(ua)
      ? "Chrome"
      : /FxiOS|Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  return `${device} · ${browser}`;
}

/** Client-side check: iOS/iPadOS Safari (including iPadOS desktop-mode UA). */
export function isIOSDevice(ua: string, maxTouchPoints = 0): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
}
