import { useRef } from "react";
import { Decision } from "../types";
import { useStore } from "../store";
import { nextAfterAnswer } from "../autoAdvance";

interface Props {
  decision: Decision | undefined;
}

export default function AnswerDock({ decision }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const answer = useStore((s) => s.answer);
  const snooze = useStore((s) => s.snooze);
  const setFocus = useStore((s) => s.setFocus);
  const focusId = useStore((s) => s.focusId);
  const queue = useStore((s) => s.queue);

  if (!decision) {
    // No pending decision — show Acknowledge to advance focus
    return (
      <div
        style={{
          borderTop: "1px solid var(--border)",
          padding: "16px 32px 18px",
          background: `color-mix(in srgb, var(--app-panel) 55%, transparent)`,
          WebkitBackdropFilter: "blur(20px)",
          backdropFilter: "blur(20px)",
        }}
      >
        <button
          className="glass-btn--clay"
          onClick={() => {
            if (focusId) {
              const next = nextAfterAnswer(queue, focusId);
              if (next) setFocus(next);
            }
          }}
          style={{ padding: "10px 24px", fontSize: 14, fontWeight: 500 }}
        >
          Acknowledge
        </button>
      </div>
    );
  }

  const sessionId = decision.sessionId;

  const handleSend = () => {
    const val = inputRef.current?.value.trim();
    if (val) {
      answer(decision.id, { custom: val });
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div
      style={{
        borderTop: "1px solid var(--border)",
        padding: "16px 32px 18px",
        background: `color-mix(in srgb, var(--app-panel) 55%, transparent)`,
        WebkitBackdropFilter: "blur(20px)",
        backdropFilter: "blur(20px)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {decision.options.map((opt, i) => (
          <div
            key={i}
            className={i === 0 ? "glass-inset" : "glass-inset glass-inset-hover"}
            onClick={() => answer(decision.id, { choice: opt.label })}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 13,
              padding: "12px 15px",
              borderRadius: 13,
              cursor: "pointer",
              background: i === 0 ? `rgba(var(--primary), 0.15)` : undefined,
              boxShadow: i === 0 ? `inset 0 0 0 1px rgb(var(--primary-soft) / 0.45)` : undefined,
            }}
          >
            <span
              className="mono faint"
              style={{
                fontSize: 11,
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: "2px 7px",
              }}
            >
              {i + 1}
            </span>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{opt.label}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 9, marginTop: 11 }}>
        <input
          ref={inputRef}
          placeholder="Type a custom reply…"
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          style={{
            flex: 1,
            borderRadius: 999,
            border: "1px solid var(--border)",
            padding: "12px 18px",
            color: "var(--text-faint)",
            fontSize: 13.5,
            background: "rgba(255,255,255,0.02)",
            outline: "none",
          }}
        />
        <button
          className="glass-btn--clay"
          onClick={handleSend}
          style={{ borderRadius: 999, padding: "0 22px", fontSize: 13.5, fontWeight: 600 }}
        >
          Send ↵
        </button>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12 }}>
        <span
          className="glass-inset-hover"
          onClick={() => {
            const next = nextAfterAnswer(queue, sessionId);
            if (next) setFocus(next);
          }}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-soft)",
            border: "1px solid var(--border)",
            borderRadius: 999,
            padding: "6px 12px",
            cursor: "pointer",
          }}
        >
          Skip ⤳
        </span>
        <span
          className="glass-inset-hover"
          onClick={() => snooze(sessionId, 15)}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-soft)",
            border: "1px solid var(--border)",
            borderRadius: 999,
            padding: "6px 12px",
            cursor: "pointer",
          }}
        >
          Snooze 15m
        </span>
        <span className="mono faint" style={{ marginLeft: "auto", fontSize: 10.5 }}>
          answer → auto-advance to next
        </span>
      </div>
    </div>
  );
}
