/**
 * PrintShare HTTP server: Next.js (pages + API) plus a WebSocket endpoint at /ws.
 *
 *  - Browsers authenticate with the session cookie and receive job/printer updates.
 *  - Windows bridges authenticate with "Authorization: Bearer <bridgeId>.<secret>" and
 *    receive job.available / job.cancel / printers.refresh commands.
 *  - API handlers publish events with pg_notify; this process LISTENs and fans out,
 *    so several instances behind a load balancer all deliver events.
 */
import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { loadEnvConfig } from "@next/env";
import next from "next";
import { Client } from "pg";
import { WebSocketServer, type WebSocket } from "ws";
import { env } from "./src/server/env";
import { sessionTokenFromHeaders, validateSessionToken } from "./src/server/auth/session";
import { authenticateBridgeToken } from "./src/server/bridge/service";
import { EVENTS_CHANNEL, type EventEnvelope } from "./src/server/events";
import { runFastMaintenance, runSlowMaintenance } from "./src/server/maintenance";
import { checkRateLimit } from "./src/server/rate-limit";

const dev = process.env.NODE_ENV !== "production";
loadEnvConfig(process.cwd(), dev);
const config = env();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

type Peer = { kind: "user"; id: string } | { kind: "bridge"; id: string };
const userSockets = new Map<string, Set<WebSocket>>();
const bridgeSockets = new Map<string, Set<WebSocket>>();
const realtimeStats = { browsers: 0, bridges: 0, listening: false };
(globalThis as Record<string, unknown>).__printshareRealtime = realtimeStats;

function remoteIp(req: IncomingMessage): string {
  if (config.TRUST_PROXY) {
    const forwarded = req.headers["x-forwarded-for"];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function requestProto(req: IncomingMessage): "http" | "https" {
  if ((req.socket as { encrypted?: boolean }).encrypted) return "https";
  if (config.TRUST_PROXY && String(req.headers["x-forwarded-proto"] ?? "").split(",")[0]?.trim() === "https") return "https";
  return "http";
}

function track(map: Map<string, Set<WebSocket>>, id: string, ws: WebSocket) {
  let set = map.get(id);
  if (!set) map.set(id, (set = new Set()));
  set.add(ws);
  ws.on("close", () => {
    set!.delete(ws);
    if (set!.size === 0) map.delete(id);
    updateStats();
  });
  updateStats();
}

function updateStats() {
  realtimeStats.browsers = [...userSockets.values()].reduce((n, s) => n + s.size, 0);
  realtimeStats.bridges = [...bridgeSockets.values()].reduce((n, s) => n + s.size, 0);
}

function send(set: Set<WebSocket> | undefined, payload: unknown) {
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) if (ws.readyState === ws.OPEN) ws.send(data);
}

async function authenticateUpgrade(req: IncomingMessage): Promise<Peer | null> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  const authorization = headers.get("authorization");
  if (authorization && authorization.slice(7).includes(".")) {
    const bridge = await authenticateBridgeToken(authorization);
    return bridge ? { kind: "bridge", id: bridge.id } : null;
  }
  // Browsers: same-origin only (cookies would otherwise be sent cross-site).
  const origin = headers.get("origin");
  if (origin) {
    const allowed = new Set([new URL(config.APP_URL).origin, `http://${headers.get("host")}`, `https://${headers.get("host")}`]);
    if (!allowed.has(origin)) return null;
  }
  const auth = await validateSessionToken(sessionTokenFromHeaders(headers));
  return auth ? { kind: "user", id: auth.user.id } : null;
}

async function startEventListener() {
  let delay = 1_000;
  const connect = async () => {
    const client = new Client({ connectionString: config.DATABASE_URL });
    client.on("notification", (msg) => {
      if (msg.channel !== EVENTS_CHANNEL || !msg.payload) return;
      try {
        const envelope = JSON.parse(msg.payload) as EventEnvelope;
        if ("userId" in envelope.target) send(userSockets.get(envelope.target.userId), envelope.event);
        else {
          send(bridgeSockets.get(envelope.target.bridgeId), envelope.event);
          if (envelope.event.type === "bridge.revoked") {
            for (const ws of bridgeSockets.get(envelope.target.bridgeId) ?? []) ws.close(4401, "revoked");
          }
        }
      } catch (err) {
        console.error("[realtime] bad notification payload", err);
      }
    });
    client.on("error", (err) => {
      console.error("[realtime] LISTEN connection error:", err.message);
    });
    client.on("end", () => {
      realtimeStats.listening = false;
      setTimeout(() => void connect().catch(retry), delay);
    });
    await client.connect();
    await client.query(`LISTEN ${EVENTS_CHANNEL}`);
    realtimeStats.listening = true;
    delay = 1_000;
    console.log("[realtime] listening for events");
  };
  const retry = (err: Error) => {
    console.error("[realtime] could not LISTEN, retrying:", err.message);
    delay = Math.min(delay * 2, 30_000);
    setTimeout(() => void connect().catch(retry), delay);
  };
  await connect().catch(retry);
}

function scheduleMaintenance() {
  const guard = (name: string, fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[maintenance] ${name} failed`, err);
    }
  };
  setInterval(guard("fast", runFastMaintenance), 30_000).unref();
  setInterval(guard("slow", runSlowMaintenance), 10 * 60_000).unref();
  setTimeout(guard("slow", runSlowMaintenance), 15_000).unref();
}

async function main() {
  const app = next({ dev, hostname: host, port });
  const handle = app.getRequestHandler();
  await app.prepare();
  const nextUpgrade = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    // Never trust client-supplied copies of our internal headers.
    req.headers["x-ps-client-ip"] = remoteIp(req);
    req.headers["x-ps-proto"] = requestProto(req);
    req.headers["x-ps-path"] = new URL(req.url ?? "/", "http://localhost").pathname;
    void handle(req, res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname !== "/ws") {
      if (dev) void nextUpgrade(req, socket, head);
      else socket.destroy();
      return;
    }
    if (!checkRateLimit(`ws:${remoteIp(req)}`, 60, 60_000).allowed) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
      socket.destroy();
      return;
    }
    authenticateUpgrade(req)
      .then((peer) => {
        if (!peer) {
          socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          (ws as WebSocket & { isAlive?: boolean }).isAlive = true;
          ws.on("pong", () => ((ws as WebSocket & { isAlive?: boolean }).isAlive = true));
          ws.on("message", () => undefined); // clients only listen
          if (peer.kind === "user") track(userSockets, peer.id, ws);
          else track(bridgeSockets, peer.id, ws);
          ws.send(JSON.stringify({ type: "hello", role: peer.kind }));
        });
      })
      .catch((err) => {
        console.error("[realtime] upgrade failed", err);
        socket.destroy();
      });
  });

  // Drop dead connections (phones going to sleep, bridges losing network).
  setInterval(() => {
    for (const ws of wss.clients) {
      const w = ws as WebSocket & { isAlive?: boolean };
      if (w.isAlive === false) {
        w.terminate();
        continue;
      }
      w.isAlive = false;
      w.ping();
    }
  }, 30_000).unref();

  await startEventListener();
  scheduleMaintenance();

  server.listen(port, host, () => {
    console.log(`> PrintShare ready on http://${host === "0.0.0.0" ? "localhost" : host}:${port} (${dev ? "development" : "production"})`);
  });

  const shutdown = () => {
    console.log("[server] shutting down");
    for (const ws of wss.clients) ws.close(1001, "server shutdown");
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5_000).unref();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
