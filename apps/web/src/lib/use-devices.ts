"use client";

import type { LiveDevice, ServerMessage } from "@crewline/core";
import { useEffect, useState } from "react";

export type LiveCrew = { devices: LiveDevice[]; feed: { text: string; ts: number }[] };

const EMPTY: LiveCrew = { devices: [], feed: [] };

/** Real phones, when a tracking server is configured. Without one, the demo crew runs alone. */
export function useDevices(): LiveCrew {
  const [live, setLive] = useState<LiveCrew>(EMPTY);
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_TRACKING_URL;
    if (!url) return;
    const token = process.env.NEXT_PUBLIC_DISPATCH_TOKEN;
    let socket: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      socket = new WebSocket(`${url}?role=dispatch${token ? `&token=${encodeURIComponent(token)}` : ""}`);
      socket.onmessage = (e) => {
        try {
          const message = JSON.parse(e.data as string) as ServerMessage;
          if (message.type === "devices") setLive((v) => ({ ...v, devices: message.devices }));
          else if (message.type === "feed") setLive((v) => ({ ...v, feed: [{ text: message.text, ts: message.ts }, ...v.feed].slice(0, 12) }));
        } catch {}
      };
      socket.onclose = () => {
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket?.close();
    };
  }, []);
  return live;
}
