// Relays what clocked-in technicians share to the dispatch board.
// Deliberately forgetful: everything is in memory, and clocking out erases that person's location.
import { newFixes, type LiveDevice, type QueuedFix, type ServerMessage } from "@crewline/core";
import { createServer, type Server } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { z } from "zod";

const Fix = z.object({ seq: z.number().int().positive(), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().nonnegative(), ts: z.number().positive() });
const Message = z.discriminatedUnion("type", [
  z.object({ type: z.literal("clock-in"), name: z.string().trim().min(1).max(30) }),
  z.object({ type: z.literal("fixes"), fixes: z.array(Fix).min(1).max(500) }),
  z.object({
    type: z.literal("event"),
    title: z.string().trim().min(1).max(80),
    event: z.object({ type: z.enum(["arrived", "left"]), siteId: z.string().max(40), ts: z.number().positive() }),
  }),
  z.object({ type: z.literal("clock-out") }),
]);

export type ServerOptions = {
  /** When set, a phone must send this to join. */
  crewCode?: string;
  /** When set, the dispatch board must send this. Set both in production: locations are private. */
  dispatchToken?: string;
  maxDevices?: number;
  /** A phone silent this long disappears from the board. */
  staleMs?: number;
};

type Device = { id: string; name: string | null; lastSeq: number; last: QueuedFix | null; note: string; socket: WebSocket };

export function createTrackingServer(options: ServerOptions = {}): { http: Server; devicesOnShift: () => number; close: () => Promise<void> } {
  const { crewCode, dispatchToken, maxDevices = 50, staleMs = 5 * 60_000 } = options;
  const http = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404).end();
  });
  // Small messages only: a batch of fixes is the biggest thing this server ever receives.
  const wss = new WebSocketServer({ server: http, maxPayload: 128 * 1024 });
  const devices = new Map<string, Device>();
  const dispatchers = new Set<WebSocket>();
  let counter = 0;

  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  };

  const snapshot = (): LiveDevice[] => {
    const out: LiveDevice[] = [];
    for (const d of devices.values()) {
      if (d.name && d.last) out.push({ id: d.id, name: d.name, at: { lat: d.last.lat, lng: d.last.lng }, accuracy: d.last.accuracy, lastSeen: d.last.ts, note: d.note });
    }
    return out;
  };
  const broadcastDevices = () => {
    const message: ServerMessage = { type: "devices", devices: snapshot() };
    for (const s of dispatchers) send(s, message);
  };
  const feed = (text: string) => {
    for (const s of dispatchers) send(s, { type: "feed", text, ts: Date.now() });
  };

  // Clears phones that went quiet, so the board never shows a stale dot as if it were live.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - staleMs;
    let changed = false;
    for (const [id, d] of devices) {
      if (d.last && d.last.ts < cutoff) {
        devices.delete(id);
        changed = true;
      }
    }
    if (changed) broadcastDevices();
  }, 30_000);
  sweep.unref();

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const role = url.searchParams.get("role");

    if (role === "dispatch") {
      if (dispatchToken && url.searchParams.get("token") !== dispatchToken) {
        send(socket, { type: "error", message: "A dispatch token is required." });
        socket.close(4001);
        return;
      }
      dispatchers.add(socket);
      send(socket, { type: "devices", devices: snapshot() });
      socket.on("close", () => dispatchers.delete(socket));
      return;
    }

    if (role !== "device" || (crewCode && url.searchParams.get("code") !== crewCode)) {
      send(socket, { type: "error", message: "That crew code isn't right." });
      socket.close(4001);
      return;
    }
    if (devices.size >= maxDevices) {
      send(socket, { type: "error", message: "The crew is full." });
      socket.close(4003);
      return;
    }

    const device: Device = { id: `d${++counter}`, name: null, lastSeq: 0, last: null, note: "On shift", socket };

    socket.on("message", (raw) => {
      let json: unknown;
      try {
        json = JSON.parse(String(raw));
      } catch {
        return;
      }
      const parsed = Message.safeParse(json);
      if (!parsed.success) {
        send(socket, { type: "error", message: "That message wasn't understood." });
        return;
      }
      const message = parsed.data;
      if (message.type === "clock-in") {
        device.name = message.name;
        devices.set(device.id, device);
        feed(`${device.name} clocked in`);
        return;
      }
      // Nothing is accepted from someone who hasn't clocked in: no shift, no location.
      if (!device.name) return;
      if (message.type === "fixes") {
        const fresh = newFixes(device.lastSeq, message.fixes);
        if (fresh.length) {
          device.lastSeq = fresh[fresh.length - 1].seq;
          device.last = fresh[fresh.length - 1];
          broadcastDevices();
        }
        // Acknowledged even when nothing was new, so a retried batch clears from the phone.
        send(socket, { type: "ack", seq: device.lastSeq });
      } else if (message.type === "event") {
        device.note = message.event.type === "arrived" ? `At: ${message.title}` : "On the road";
        feed(`${device.name} ${message.event.type === "arrived" ? "arrived at" : "left"} ${message.title}`);
        broadcastDevices();
      } else if (message.type === "clock-out") {
        const name = device.name;
        device.name = null;
        device.last = null;
        devices.delete(device.id);
        feed(`${name} clocked out. Their location was erased.`);
        broadcastDevices();
      }
    });
    socket.on("close", () => {
      // A dropped connection isn't clocking out: the phone will reconnect and catch up.
      // The stale sweep removes it if it never does.
      if (device.name && device.last) {
        device.note = "Connection lost";
        broadcastDevices();
      } else {
        devices.delete(device.id);
      }
    });
  });

  return {
    http,
    devicesOnShift: () => snapshot().length,
    close: () =>
      new Promise((resolve) => {
        clearInterval(sweep);
        for (const c of wss.clients) c.terminate();
        wss.close(() => http.close(() => resolve()));
      }),
  };
}
