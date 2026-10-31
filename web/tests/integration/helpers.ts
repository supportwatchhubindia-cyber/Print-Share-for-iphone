import { NextRequest } from "next/server";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { prisma } from "@/server/db";

export const ORIGIN = "http://localhost:3000";

/** Empties every table in the dedicated *test* database before a test file runs. */
export async function resetTestDatabase() {
  const dbName = new URL(process.env.DATABASE_URL ?? "").pathname;
  if (!/test/i.test(dbName)) throw new Error(`Refusing to truncate non-test database ${dbName}`);
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
}

// Route handlers declare their own param shapes; the helper supplies whatever the test passes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handler = (req: NextRequest, ctx: { params: Promise<any> }) => Promise<Response>;

export type CallOptions = {
  body?: unknown;
  form?: FormData;
  cookie?: string;
  bearer?: string;
  headers?: Record<string, string>;
  params?: Record<string, string>;
  ip?: string;
};

/** Invokes a Next.js route handler exactly as the server would, returning status + parsed JSON. */
export async function call(handler: Handler, method: string, path: string, opts: CallOptions = {}) {
  const headers = new Headers({ origin: ORIGIN, host: "localhost:3000", "x-ps-client-ip": opts.ip ?? "127.0.0.1", ...opts.headers });
  if (opts.cookie) headers.set("cookie", opts.cookie);
  if (opts.bearer) headers.set("authorization", `Bearer ${opts.bearer}`);
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers.set("content-type", "application/json");
  }
  const req = new NextRequest(new URL(path, ORIGIN), { method, headers, body });
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) });
  const type = res.headers.get("content-type") ?? "";
  const data = type.includes("application/json") ? await res.json() : null;
  return { status: res.status, data, res };
}

export function sessionCookie(res: Response): string {
  const raw = res.headers.getSetCookie().find((c) => c.startsWith("ps_session="));
  if (!raw) throw new Error("No session cookie set");
  return raw.split(";")[0]!;
}

export async function makePdf(pages: number): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) pdf.addPage([595, 842]).drawText(`Page ${i}`, { x: 50, y: 780, size: 24, font });
  return Buffer.from(await pdf.save());
}

export function fileForm(name: string, data: Buffer, type: string) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(data)], name, { type }));
  return form;
}
