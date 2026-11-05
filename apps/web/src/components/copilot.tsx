"use client";

import { useEffect, useRef, useState } from "react";
import { askCopilot, type Reply, type Turn } from "@/lib/copilot";
import type { Sim } from "@/lib/use-sim";
import { Bullet } from "./side-panel";

const STARTERS = ["What needs my attention right now?", "Who should take the Cabbagetown no-heat call?", "How is Sam's day looking?"];

type Message = { id: number; role: "user"; text: string } | ({ id: number; role: "copilot" } & Reply);

export function Copilot({ sim, onJob }: { sim: Sim; onJob: (id: string) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const nextId = useRef(1);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setInput("");
    setMessages((m) => [...m, { id: nextId.current++, role: "user", text: question }]);
    setBusy("Reading your question");
    const history: Turn[] = messages.slice(-6).map((m) => ({ role: m.role === "user" ? "user" : "model", text: m.text }));
    const reply = await askCopilot(history, question, sim.plan, sim.t, setBusy);
    setMessages((m) => [...m, { id: nextId.current++, role: "copilot", ...reply }]);
    setBusy(null);
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 && (
          <div>
            <h2 className="text-lg leading-tight font-extrabold">Ask about the crew, in plain words.</h2>
            <p className="mt-1 text-[14px] leading-snug text-ink-2">It reads the live board and suggests. You decide: nothing is assigned until you press Assign.</p>
            <div className="mt-3 flex flex-col gap-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} className="rounded-md bg-sunk px-3 py-2.5 text-left text-[14px] font-semibold hover:opacity-80">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-3">
          {messages.map((m) =>
            m.role === "user" ? (
              <p key={m.id} className="ml-8 self-end rounded-lg bg-cta px-3 py-2 text-[14px] leading-snug text-on-cta">{m.text}</p>
            ) : (
              <div key={m.id}>
                {m.steps.map((s) => <p key={s} className="text-[12px] font-semibold text-good">✓ {s}</p>)}
                <p className="mt-1 text-[15px] leading-snug">{m.text}</p>
                {m.ranking && m.ranking.candidates.length > 0 && !sim.board.days.some((d) => d.stops.some((s) => s.job.id === m.ranking!.job.id)) && (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {m.ranking.candidates.slice(0, 3).map((c, i) => (
                      <li key={c.tech.id} className={`flex items-center gap-2 rounded-md border p-2 ${i === 0 ? "border-ink" : "border-hair"}`}>
                        <Bullet tech={c.tech} size={22} />
                        <span className="flex-1 text-[14px] font-bold">{c.tech.name}</span>
                        <button
                          type="button"
                          className={`rounded px-2.5 py-1 text-[13px] font-bold ${i === 0 ? "bg-cta text-on-cta" : "bg-sunk"}`}
                          onClick={() => {
                            sim.assign(m.ranking!.job.id, c);
                            onJob(m.ranking!.job.id);
                          }}
                          aria-label={`Assign to ${c.tech.name}`}
                        >
                          Assign
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {m.unverified.length > 0 && <p className="mt-1 text-[12.5px] font-semibold text-tight">Couldn&apos;t match {m.unverified.join(", ")} to the board. Check before acting on it.</p>}
                {m.mode === "offline" && <p className="mt-1 text-[12.5px] text-ink-3">Answered from the board&apos;s rules, without the AI model.</p>}
              </div>
            ),
          )}
          {busy && <p className="text-[13px] font-semibold text-ink-3">{busy}…</p>}
          <div ref={end} />
        </div>
      </div>
      <form
        className="flex gap-2 border-t border-hair p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={300}
          placeholder="Ask about the crew"
          aria-label="Ask the copilot"
          className="min-w-0 flex-1 rounded-md bg-sunk px-3 py-2 text-[15px] placeholder:text-ink-3"
        />
        <button type="submit" disabled={!input.trim() || !!busy} className="rounded-md bg-cta px-3 py-2 text-[14px] font-bold text-on-cta disabled:opacity-40">
          Ask
        </button>
      </form>
    </>
  );
}
