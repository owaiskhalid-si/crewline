import type { QueuedFix, ServerMessage } from "@crewline/core";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createTrackingServer, type ServerOptions } from "./tracking-server";

let server: ReturnType<typeof createTrackingServer> | null = null;
const sockets: WebSocket[] = [];

async function start(options: ServerOptions = {}) {
  server = createTrackingServer(options);
  await new Promise<void>((r) => server!.http.listen(0, r));
  return (server.http.address() as AddressInfo).port;
}

type Client = { socket: WebSocket; messages: ServerMessage[]; closeCode: Promise<number>; send: (m: unknown) => void; until: (test: (m: ServerMessage) => boolean) => Promise<ServerMessage> };

function connect(port: number, query: string): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://localhost:${port}?${query}`);
    sockets.push(socket);
    const messages: ServerMessage[] = [];
    const waiters: { test: (m: ServerMessage) => boolean; done: (m: ServerMessage) => void }[] = [];
    socket.on("message", (raw) => {
      const m = JSON.parse(String(raw)) as ServerMessage;
      messages.push(m);
      for (const w of [...waiters]) {
        if (w.test(m)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.done(m);
        }
      }
    });
    const closeCode = new Promise<number>((r) => socket.on("close", (code) => r(code)));
    socket.on("error", reject);
    socket.on("open", () =>
      resolve({
        socket,
        messages,
        closeCode,
        send: (m) => socket.send(JSON.stringify(m)),
        until: (test) =>
          new Promise((done, fail) => {
            const hit = messages.find(test);
            if (hit) return done(hit);
            const timer = setTimeout(() => fail(new Error(`Timed out. Saw: ${JSON.stringify(messages)}`)), 2500);
            waiters.push({ test, done: (m) => { clearTimeout(timer); done(m); } });
          }),
      }),
    );
  });
}

const fix = (seq: number, lat = 43.65, lng = -79.38): QueuedFix => ({ seq, lat, lng, accuracy: 10, ts: Date.now() });
const devicesOf = (m: ServerMessage) => (m.type === "devices" ? m.devices : []);

afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await server?.close();
  server = null;
});

describe("tracking server", () => {
  it("relays a clocked-in phone to the dispatch board", async () => {
    const port = await start();
    const board = await connect(port, "role=dispatch");
    const phone = await connect(port, "role=device");
    phone.send({ type: "clock-in", name: "Alex" });
    await board.until((m) => m.type === "feed" && m.text === "Alex clocked in");
    phone.send({ type: "fixes", fixes: [fix(1)] });
    const seen = await board.until((m) => devicesOf(m).length === 1);
    expect(devicesOf(seen)[0]).toMatchObject({ name: "Alex", at: { lat: 43.65, lng: -79.38 } });
    expect(await phone.until((m) => m.type === "ack")).toEqual({ type: "ack", seq: 1 });
  });

  it("ignores location from anyone who hasn't clocked in", async () => {
    const port = await start();
    const board = await connect(port, "role=dispatch");
    const phone = await connect(port, "role=device");
    phone.send({ type: "fixes", fixes: [fix(1)] });
    await new Promise((r) => setTimeout(r, 120));
    expect(board.messages.flatMap(devicesOf)).toEqual([]);
    expect(phone.messages.some((m) => m.type === "ack")).toBe(false);
    expect(server!.devicesOnShift()).toBe(0);
  });

  it("erases the location at clock-out, and tells the board", async () => {
    const port = await start();
    const board = await connect(port, "role=dispatch");
    const phone = await connect(port, "role=device");
    phone.send({ type: "clock-in", name: "Alex" });
    phone.send({ type: "fixes", fixes: [fix(1)] });
    await board.until((m) => devicesOf(m).length === 1);
    phone.send({ type: "clock-out" });
    await board.until((m) => m.type === "feed" && m.text.includes("erased"));
    await new Promise((r) => setTimeout(r, 50));
    expect(devicesOf(board.messages.filter((m) => m.type === "devices").at(-1)!)).toEqual([]);
    expect(server!.devicesOnShift()).toBe(0);
    // Anything sent after clocking out is refused.
    phone.send({ type: "fixes", fixes: [fix(2)] });
    await new Promise((r) => setTimeout(r, 80));
    expect(server!.devicesOnShift()).toBe(0);
  });

  it("makes a retried batch harmless and still acknowledges it", async () => {
    const port = await start();
    const board = await connect(port, "role=dispatch");
    const phone = await connect(port, "role=device");
    phone.send({ type: "clock-in", name: "Alex" });
    phone.send({ type: "fixes", fixes: [fix(1, 43.1), fix(2, 43.2)] });
    await phone.until((m) => m.type === "ack" && m.seq === 2);
    const before = board.messages.filter((m) => m.type === "devices").length;
    phone.send({ type: "fixes", fixes: [fix(1, 10), fix(2, 11)] });
    await new Promise((r) => setTimeout(r, 80));
    expect(phone.messages.filter((m) => m.type === "ack")).toHaveLength(2);
    expect(board.messages.filter((m) => m.type === "devices")).toHaveLength(before);
    expect(devicesOf(board.messages.filter((m) => m.type === "devices").at(-1)!)[0].at.lat).toBe(43.2);
  });

  it("delivers a catch-up after a dead zone, ending on the newest fix", async () => {
    const port = await start();
    const board = await connect(port, "role=dispatch");
    const phone = await connect(port, "role=device");
    phone.send({ type: "clock-in", name: "Alex" });
    const queued = Array.from({ length: 200 }, (_, i) => fix(i + 1, 43 + i / 1000));
    phone.send({ type: "fixes", fixes: queued });
    const seen = await board.until((m) => devicesOf(m).length === 1);
    expect(devicesOf(seen)[0].at.lat).toBeCloseTo(43.199, 3);
    expect(await phone.until((m) => m.type === "ack")).toEqual({ type: "ack", seq: 200 });
  });

  it("passes arrivals to the board's feed", async () => {
    const port = await start();
    const board = await connect(port, "role=dispatch");
    const phone = await connect(port, "role=device");
    phone.send({ type: "clock-in", name: "Alex" });
    phone.send({ type: "fixes", fixes: [fix(1)] });
    phone.send({ type: "event", title: "Furnace tune-up", event: { type: "arrived", siteId: "near", ts: Date.now() } });
    await board.until((m) => m.type === "feed" && m.text === "Alex arrived at Furnace tune-up");
    const update = await board.until((m) => devicesOf(m)[0]?.note === "At: Furnace tune-up");
    expect(update).toBeTruthy();
  });

  it("refuses bad data without falling over", async () => {
    const port = await start();
    const phone = await connect(port, "role=device");
    phone.socket.send("not json at all");
    phone.send({ type: "clock-in", name: "" });
    phone.send({ type: "fixes", fixes: [{ seq: 1, lat: 999, lng: 0, accuracy: 5, ts: 1 }] });
    phone.send({ type: "something-else" });
    await phone.until((m) => m.type === "error");
    expect(server!.devicesOnShift()).toBe(0);
    expect((await fetch(`http://localhost:${port}/health`)).status).toBe(200);
  });

  it("keeps the crew code and dispatch token", async () => {
    const port = await start({ crewCode: "lake", dispatchToken: "secret" });
    expect(await (await connect(port, "role=device&code=nope")).closeCode).toBe(4001);
    expect(await (await connect(port, "role=dispatch")).closeCode).toBe(4001);
    expect(await (await connect(port, "role=nothing")).closeCode).toBe(4001);
    const phone = await connect(port, "role=device&code=lake");
    const board = await connect(port, "role=dispatch&token=secret");
    phone.send({ type: "clock-in", name: "Alex" });
    await board.until((m) => m.type === "feed");
  });

  it("keeps a phone on the board through a dropped connection, and says so", async () => {
    const port = await start();
    const board = await connect(port, "role=dispatch");
    const phone = await connect(port, "role=device");
    phone.send({ type: "clock-in", name: "Alex" });
    phone.send({ type: "fixes", fixes: [fix(1)] });
    await board.until((m) => devicesOf(m).length === 1);
    phone.socket.close();
    await board.until((m) => devicesOf(m)[0]?.note === "Connection lost");
    expect(server!.devicesOnShift()).toBe(1);
  });
});
