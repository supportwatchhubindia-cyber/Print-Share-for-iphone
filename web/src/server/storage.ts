import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile, rename, readdir } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { env } from "./env";

const KEY_PATTERN = /^[A-Za-z0-9_\-]+(\/[A-Za-z0-9_\-.]+)*$/;

export function storageRoot(): string {
  return resolve(env().STORAGE_DIR);
}

/** Maps a storage key to an absolute path, refusing anything that escapes the root. */
export function pathForKey(key: string): string {
  if (!KEY_PATTERN.test(key) || key.includes("..")) throw new Error(`Invalid storage key: ${key}`);
  const root = storageRoot();
  const full = resolve(root, ...key.split("/"));
  if (!full.startsWith(root + sep)) throw new Error("Storage key escapes storage root");
  return full;
}

export async function writeObject(key: string, data: Buffer | Uint8Array): Promise<void> {
  const path = pathForKey(key);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, { mode: 0o600 });
  await rename(tmp, path);
}

export async function readObject(key: string): Promise<Buffer> {
  return readFile(pathForKey(key));
}

export async function objectSize(key: string): Promise<number | null> {
  try {
    return (await stat(pathForKey(key))).size;
  } catch {
    return null;
  }
}

export function objectWebStream(key: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(pathForKey(key))) as ReadableStream<Uint8Array>;
}

/** Removes a key prefix (a document folder). Safe to call repeatedly. */
export async function deletePrefix(prefix: string): Promise<void> {
  await rm(pathForKey(prefix), { recursive: true, force: true });
}

export async function storageUsageBytes(): Promise<number> {
  async function walk(dir: string): Promise<number> {
    let total = 0;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) total += await walk(p);
      else if (e.isFile()) total += (await stat(p)).size;
    }
    return total;
  }
  return walk(storageRoot());
}

export async function storageWritable(): Promise<boolean> {
  try {
    await mkdir(storageRoot(), { recursive: true });
    const probe = join(storageRoot(), `.probe-${process.pid}`);
    await writeFile(probe, "ok");
    await rm(probe, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function documentFolder(userId: string, documentId: string) {
  return `${userId}/${documentId}`;
}

export function documentKey(userId: string, documentId: string, file: string) {
  return `${documentFolder(userId, documentId)}/${file}`;
}
