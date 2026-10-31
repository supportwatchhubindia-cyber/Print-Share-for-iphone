import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { env, storageDriverName } from "./env";

/**
 * Object storage for uploads and print-ready PDFs.
 *  - local:       files under STORAGE_DIR (self-hosted; never web-served)
 *  - vercel-blob: *private* Vercel Blob objects (serverless; the function filesystem is ephemeral)
 * Keys are the same for both drivers: "<userId>/<documentId>/<file>".
 */

const KEY_PATTERN = /^[A-Za-z0-9_\-]+(\/[A-Za-z0-9_\-.]+)*$/;

function assertKey(key: string) {
  if (!KEY_PATTERN.test(key) || key.includes("..")) throw new Error(`Invalid storage key: ${key}`);
}

function blobDriver(): boolean {
  const driver = storageDriverName();
  if (driver === "local" && env().VERCEL) {
    throw new Error("Vercel deployments need Vercel Blob storage: connect a Blob store to the project (sets BLOB_READ_WRITE_TOKEN).");
  }
  return driver === "vercel-blob";
}

// ---------------------------------------------------------------- local driver

export function storageRoot(): string {
  return resolve(env().STORAGE_DIR);
}

/** Maps a storage key to an absolute path, refusing anything that escapes the root. */
export function pathForKey(key: string): string {
  assertKey(key);
  const root = storageRoot();
  const full = resolve(root, ...key.split("/"));
  if (!full.startsWith(root + sep)) throw new Error("Storage key escapes storage root");
  return full;
}

async function localUsage(dir: string): Promise<number> {
  let total = 0;
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) total += await localUsage(p);
    else if (e.isFile()) total += (await stat(p)).size;
  }
  return total;
}

// ---------------------------------------------------------------- public API

export async function writeObject(key: string, data: Buffer | Uint8Array, contentType = "application/octet-stream"): Promise<void> {
  assertKey(key);
  if (blobDriver()) {
    const { put } = await import("@vercel/blob");
    await put(key, Buffer.from(data), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType });
    return;
  }
  const path = pathForKey(key);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, path);
}

/** Opens an object for streaming, or null if it does not exist. */
export async function openObject(key: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null> {
  assertKey(key);
  if (blobDriver()) {
    const { get } = await import("@vercel/blob");
    const result = await get(key, { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return { stream: result.stream, size: result.blob.size };
  }
  try {
    const path = pathForKey(key);
    const { size } = await stat(path);
    return { stream: Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, size };
  } catch {
    return null;
  }
}

/** Reads a whole object into memory, refusing anything larger than maxBytes. */
export async function readObject(key: string, maxBytes: number): Promise<Buffer | null> {
  const opened = await openObject(key);
  if (!opened) return null;
  if (opened.size > maxBytes) {
    await opened.stream.cancel();
    throw new RangeError(`Object is larger than ${maxBytes} bytes`);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = opened.stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RangeError(`Object is larger than ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/**
 * A short-lived URL the browser or bridge can download from directly (Vercel Blob only).
 * Returns null for local storage, where the app streams the file itself.
 */
export async function presignedObjectUrl(key: string, ttlSeconds: number): Promise<string | null> {
  assertKey(key);
  if (!blobDriver()) return null;
  const { issueSignedToken, presignUrl } = await import("@vercel/blob");
  const validUntil = Date.now() + ttlSeconds * 1000;
  const token = await issueSignedToken({ pathname: key, operations: ["get"], validUntil });
  const { presignedUrl } = await presignUrl(token, { operation: "get", pathname: key, access: "private", validUntil });
  return presignedUrl;
}

export async function deleteObject(key: string): Promise<void> {
  assertKey(key);
  if (blobDriver()) {
    const { del } = await import("@vercel/blob");
    await del(key);
    return;
  }
  await rm(pathForKey(key), { force: true });
}

/** Removes everything under a key prefix (a document folder). Safe to call repeatedly. */
export async function deletePrefix(prefix: string): Promise<void> {
  assertKey(prefix);
  if (blobDriver()) {
    const { list, del } = await import("@vercel/blob");
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: `${prefix}/`, cursor, limit: 1000 });
      if (page.blobs.length) await del(page.blobs.map((b) => b.url));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return;
  }
  await rm(pathForKey(prefix), { recursive: true, force: true });
}

export async function storageUsageBytes(): Promise<number> {
  if (blobDriver()) {
    const { list } = await import("@vercel/blob");
    let total = 0;
    let cursor: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = await list({ cursor, limit: 1000 });
      total += result.blobs.reduce((sum, b) => sum + b.size, 0);
      if (!result.hasMore) break;
      cursor = result.cursor;
    }
    return total;
  }
  return localUsage(storageRoot());
}

export async function storageHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    if (blobDriver()) {
      const used = await storageUsageBytes();
      return { ok: true, detail: `Vercel Blob (private) · ${(used / 1048576).toFixed(1)} MB stored` };
    }
    await mkdir(storageRoot(), { recursive: true });
    const probe = join(storageRoot(), `.probe-${process.pid}`);
    await writeFile(probe, "ok");
    await rm(probe, { force: true });
    return { ok: true, detail: `Local disk · ${((await storageUsageBytes()) / 1048576).toFixed(1)} MB in ${env().STORAGE_DIR}` };
  } catch (err) {
    return { ok: false, detail: (err as Error).message.slice(0, 200) };
  }
}

export function documentFolder(userId: string, documentId: string) {
  return `${userId}/${documentId}`;
}

export function documentKey(userId: string, documentId: string, file: string) {
  return `${documentFolder(userId, documentId)}/${file}`;
}

/** Browser uploads on Vercel land here first: "incoming/<userId>/<random>.<ext>". */
export const INCOMING_PATTERN = /^incoming\/([A-Za-z0-9_-]{8,64})\/([a-f0-9]{24,64})\.(pdf|jpg|jpeg|png|docx|xlsx|pptx|txt)$/;
