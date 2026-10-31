// Framework-free error types. Kept separate from http.ts (which imports next/server) so that
// server.ts can load domain services before Next.js has initialised its runtime.

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new ApiError(400, "BAD_REQUEST", message, details);
export const unauthorized = (message = "Sign in to continue.") => new ApiError(401, "UNAUTHORIZED", message);
export const forbidden = (message = "You do not have access to this resource.") => new ApiError(403, "FORBIDDEN", message);
export const notFound = (what = "Resource") => new ApiError(404, "NOT_FOUND", `${what} not found.`);
export const conflict = (message: string, code = "CONFLICT", details?: Record<string, unknown>) =>
  new ApiError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(422, code, message, details);

/** Client IP as injected by server.ts (never trusted from the client directly). */
export function clientIp(req: Request): string {
  return req.headers.get("x-ps-client-ip") ?? "unknown";
}

export function isSecureRequest(req: Request): boolean {
  const proto = req.headers.get("x-ps-proto");
  if (proto) return proto === "https";
  return new URL(req.url).protocol === "https:";
}
