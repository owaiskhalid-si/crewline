import type { LatLng, ServerMessage } from "@crewline/core";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { applyFix, clearOutbox, confirmed, finishJob, practiceStep, startShift, type Shift } from "./shift";

export type LinkState = "none" | "connecting" | "connected" | "offline";

/** Used when the phone can't give a location, so the practice walk still works. */
const FALLBACK: LatLng = { lat: 43.6532, lng: -79.3832 };
const RETRY_MS = 3000;

export function useShift(name: string, serverUrl: string) {
  const [shift, setShift] = useState<Shift | null>(null);
  const [link, setLink] = useState<LinkState>("none");
  const [walking, setWalking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const latest = useRef<Shift | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const wantLink = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnect = useRef<() => void>(() => {});

  const commit = useCallback((next: Shift | null) => {
    latest.current = next;
    setShift(next);
  }, []);

  // Sends whatever is waiting. Called on connect and after each fix, and harmless to repeat.
  const flush = useCallback(() => {
    const s = latest.current;
    const ws = socket.current;
    if (!s || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (s.queue.items.length) ws.send(JSON.stringify({ type: "fixes", fixes: s.queue.items.slice(0, 500) }));
    if (s.outbox.length) {
      for (const o of s.outbox) ws.send(JSON.stringify({ type: "event", event: o.event, title: o.title }));
      commit(clearOutbox(s));
    }
  }, [commit]);

  const connect = useCallback(() => {
    if (!serverUrl || !wantLink.current) return;
    setLink("connecting");
    try {
      const ws = new WebSocket(`${serverUrl}?role=device`);
      socket.current = ws;
      ws.onopen = () => {
        setLink("connected");
        ws.send(JSON.stringify({ type: "clock-in", name }));
        flush();
      };
      ws.onmessage = (e) => {
        try {
          const message = JSON.parse(String(e.data)) as ServerMessage;
          if (message.type === "ack" && latest.current) commit(confirmed(latest.current, message.seq));
        } catch {}
      };
      ws.onclose = () => {
        if (!wantLink.current) return;
        setLink("offline");
        retry.current = setTimeout(() => reconnect.current(), RETRY_MS);
      };
      ws.onerror = () => ws.close();
    } catch {
      setLink("offline");
    }
  }, [serverUrl, name, flush, commit]);

  useEffect(() => {
    reconnect.current = connect;
  }, [connect]);

  const onFix = useCallback(
    (fix: { lat: number; lng: number; accuracy: number; ts: number }) => {
      const s = latest.current;
      if (!s) return;
      const { shift: next, arrived } = applyFix(s, fix);
      commit(next);
      if (arrived && Platform.OS !== "web") void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      flush();
    },
    [commit, flush],
  );

  const clockIn = useCallback(async () => {
    setProblem(null);
    setStarting(true);
    let at = FALLBACK;
    let live = false;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        at = { lat: here.coords.latitude, lng: here.coords.longitude };
        live = true;
      } else {
        setProblem("Location is off, so the practice walk will stand in for GPS. You can turn it on in Settings.");
      }
    } catch {
      setProblem("This device couldn't give a location, so the practice walk will stand in for GPS.");
    }
    commit(startShift(at, Date.now()));
    wantLink.current = true;
    connect();
    if (live) {
      try {
        watcher.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 8 }, (p) => {
          onFix({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? 50, ts: p.timestamp });
        });
      } catch {
        setProblem("Couldn't follow your location. The practice walk still works.");
      }
    }
    setStarting(false);
  }, [commit, connect, onFix]);

  const clockOut = useCallback(() => {
    wantLink.current = false;
    if (retry.current) clearTimeout(retry.current);
    watcher.current?.remove();
    watcher.current = null;
    setWalking(false);
    const ws = socket.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "clock-out" }));
    ws?.close();
    socket.current = null;
    setLink("none");
    commit(null);
  }, [commit]);

  const finish = useCallback(
    (id: string) => {
      if (latest.current) commit(finishJob(latest.current, id));
    },
    [commit],
  );

  useEffect(() => {
    if (!walking) return;
    const id = setInterval(() => {
      const s = latest.current;
      if (!s) return;
      const fix = practiceStep(s, Date.now());
      if (fix) onFix(fix);
      else setWalking(false);
    }, 1000);
    return () => clearInterval(id);
  }, [walking, onFix]);

  // Stops following the phone if the app closes the screen mid-shift.
  useEffect(
    () => () => {
      wantLink.current = false;
      if (retry.current) clearTimeout(retry.current);
      watcher.current?.remove();
      socket.current?.close();
    },
    [],
  );

  return { shift, link, walking, setWalking, problem, starting, clockIn, clockOut, finish };
}
