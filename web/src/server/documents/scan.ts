import { connect } from "node:net";
import { env } from "../env";

export type ScanResult = { status: "CLEAN" | "INFECTED" | "SKIPPED" | "ERROR"; detail?: string };

const CHUNK = 64 * 1024;

/**
 * Streams a buffer to clamd using the INSTREAM protocol:
 *   "zINSTREAM\0" then <uint32 BE length><bytes>... then a zero-length chunk.
 * clamd replies "stream: OK" or "stream: <Signature> FOUND".
 */
export function clamdInstream(host: string, port: number, data: Buffer, timeoutMs = 30_000): Promise<ScanResult> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let reply = "";
    let settled = false;
    const finish = (result: ScanResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs, () => finish({ status: "ERROR", detail: "Malware scanner timed out" }));
    socket.on("error", (err) => finish({ status: "ERROR", detail: `Malware scanner unavailable: ${err.message}` }));
    socket.on("data", (chunk) => {
      reply += chunk.toString("utf8");
      if (reply.includes("\0") || reply.includes("\n")) socket.end();
    });
    socket.on("close", () => {
      const text = reply.replace(/\0/g, "").trim();
      if (/:\s*OK$/.test(text)) finish({ status: "CLEAN" });
      else if (/FOUND$/.test(text)) {
        const signature = text.replace(/^stream:\s*/, "").replace(/\s*FOUND$/, "");
        finish({ status: "INFECTED", detail: signature });
      } else finish({ status: "ERROR", detail: text || "No response from malware scanner" });
    });
    socket.on("connect", () => {
      socket.write("zINSTREAM\0");
      for (let offset = 0; offset < data.length; offset += CHUNK) {
        const slice = data.subarray(offset, offset + CHUNK);
        const len = Buffer.alloc(4);
        len.writeUInt32BE(slice.length, 0);
        socket.write(len);
        socket.write(slice);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}

/** Health check: clamd answers "PONG" to "zPING\0". */
export function clamdPing(host: string, port: number, timeoutMs = 3_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    let reply = "";
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.on("error", () => done(false));
    socket.on("connect", () => socket.write("zPING\0"));
    socket.on("data", (d) => {
      reply += d.toString();
      if (reply.includes("PONG")) done(true);
    });
    socket.on("close", () => done(reply.includes("PONG")));
  });
}

/** Malware scanning integration point. Configure CLAMAV_HOST to enable. */
export async function scanUpload(data: Buffer): Promise<ScanResult> {
  const { CLAMAV_HOST, CLAMAV_PORT } = env();
  if (!CLAMAV_HOST) return { status: "SKIPPED", detail: "No malware scanner configured" };
  return clamdInstream(CLAMAV_HOST, CLAMAV_PORT, data);
}
