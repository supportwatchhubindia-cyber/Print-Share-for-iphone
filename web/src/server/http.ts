import { NextResponse, type NextRequest } from "next/server";
import { ZodError, type ZodType, type ZodTypeDef } from "zod";
import { Prisma } from "@prisma/client";
import { env } from "./env";
import { ApiError, badRequest, forbidden } from "./errors";

// Route handlers import everything HTTP-related from here; domain services import ./errors directly.
export * from "./errors";

export function json<T>(body: T, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function errorResponse(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (err.status === 429 && typeof err.details?.retryAfterSeconds === "number") {
      headers["Retry-After"] = String(err.details.retryAfterSeconds);
    }
    return NextResponse.json(
      { error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } },
      { status: err.status, headers },
    );
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    return NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message: "Please check the highlighted fields.", details: { fields } } },
      { status: 400 },
    );
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Resource not found." } }, { status: 404 });
  }
  console.error("[api] unhandled error", err);
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side. Please try again." } },
    { status: 500 },
  );
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * CSRF defence for cookie-authenticated requests: a browser always sends Origin on
 * cross-origin mutations, so any Origin that is neither APP_URL nor this host is rejected.
 * Bearer-token clients (bridge, native apps) are not exposed to CSRF.
 */
export function assertSameOrigin(req: NextRequest) {
  if (!MUTATING.has(req.method)) return;
  if (req.headers.get("authorization")) return;
  const origin = req.headers.get("origin");
  if (!origin) return;
  const allowed = new Set<string>([new URL(env().APP_URL).origin]);
  const host = req.headers.get("host");
  if (host) {
    allowed.add(`http://${host}`);
    allowed.add(`https://${host}`);
  }
  if (!allowed.has(origin)) throw forbidden("Cross-origin request blocked.");
}

type RouteContext<P> = { params: Promise<P> };

/** Wraps a route handler with origin checks and uniform error handling. */
export function api<P extends Record<string, string> = Record<string, string>>(
  fn: (req: NextRequest, ctx: { params: P }) => Promise<Response>,
) {
  return async (req: NextRequest, ctx: RouteContext<P>): Promise<Response> => {
    try {
      assertSameOrigin(req);
      const params = (ctx?.params ? await ctx.params : {}) as P;
      return await fn(req, { params });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson<Out, In = Out>(req: NextRequest, schema: ZodType<Out, ZodTypeDef, In>): Promise<Out> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
  return schema.parse(body);
}


