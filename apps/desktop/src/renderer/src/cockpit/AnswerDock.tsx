import { useRef, useState, useEffect } from "react";
import { Decision } from "../types";
import { useStore } from "../store";
import { nextAfterAnswer } from "../autoAdvance";
import Kbd from "./Kbd";

interface Props {
  decision: Decision | undefined;
  /** True while Claude is mid-turn — enables the interrupt (Esc) controls. */
  working?: boolean;
  /** The focused session (used when there's no decision to derive it from). */
  sessionId?: string;
}

export default function AnswerDock({ decision, working, sessionId: sessionIdProp }: Props) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const idleInputRef = useRef<HTMLTextAreaElement>(null);
  const [sent, setSent] = useState(false);
  const [idleSent, setIdleSent] = useState(false);
  const answer = useStore((s) => s.answer);
  const snooze = useStore((s) => s.snooze);
  const setFocus = useStore((s) => s.setFocus);
  const focusId = useStore((s) => s.focusId);
  const queue = useStore((s) => s.queue);
  const instruct = useStore((s) => s.instruct);
  const interrupt = useStore((s) => s.interrupt);
  const idleSessionId = sessionIdProp ?? focusId;

  // Skip (Ctrl+→) and Snooze (Ctrl+S) shortcuts — only active while a decision is shown.
  useEffect(() => {
    if (!decision) return;
    const sid = decision.sessionId;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = nextAfterAnswer(queue, sid);
        if (next) setFocus(next);
      } else if (e.key.toLowerCase() === "s" && !e.shiftKey) {
        e.preventDefault();
        snooze(sid, 15);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decision, queue, setFocus, snooze]);

  const textareaStyle: React.CSSProperties = {
    flex: 1,
    borderRadius: 16,
    border: "1px solid var(--border)",
    padding: "12px 16px",
    color: "var(--text)",
    caretColor: "rgb(var(--primary-soft))",
    fontSize: 13.5,
    background: "rgba(255,255,255,0.03)",
    outline: "none",
    resize: "none",
    minHeight: 44,
    maxHeight: 140,
    overflowY: "auto",
    lineHeight: 1.5,
    fontFamily: "var(--font-body)",
    width: "100%",
    minWidth: 0, // let the flex item shrink instead of pushing the column wider
    maxWidth: "100%",
    boxSizing: "border-box",
    overflowWrap: "anywhere",
  };

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = Math.min(140, el.scrollHeight) + "px";
  }

  if (!decision) {
    // No pending decision. While Claude works, this dock redirects it — sending
    // interrupts (Esc) the current turn then types the new instruction; a bare
    // Stop just aborts. When idle, it's a normal free-text instruction + Acknowledge.
    const submitIdle = () => {
      const el = idleInputRef.current;
      const val = el?.value.trim();
      if (!val || !idleSessionId) return;
      if (working) interrupt(idleSessionId, val);
      else instruct(idleSessionId, val);
      if (el) { el.value = ""; el.style.height = "auto"; }
      setIdleSent(true);
      setTimeout(() => setIdleSent(false), 1800);
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
        <div style={{ display: "flex", gap: 9, marginBottom: 10, alignItems: "flex-end", minWidth: 0 }}>
          <textarea
            ref={idleInputRef}
            className="reply-input no-scrollbar"
            placeholder={working ? "Interrupt Claude and tell it what to do instead…" : "Send an instruction…"}
            rows={1}
            onInput={(e) => autoGrow(e.currentTarget)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submitIdle();
              }
            }}
            style={textareaStyle}
          />
          <button
            className="glass-btn--clay"
            onClick={submitIdle}
            style={{ borderRadius: 999, padding: "0 22px", height: 44, fontSize: 13.5, fontWeight: 600, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            {working ? "Interrupt & send" : "Send"} <Kbd>⌅</Kbd>
          </button>
        </div>
        {idleSent && (
          <span className="mono" style={{ display: "block", fontSize: 11, color: "rgb(var(--accent))", marginBottom: 6 }}>✓ sent</span>
        )}
        {working ? (
          <button
            className="glass-btn--clay"
            onClick={() => { if (idleSessionId) interrupt(idleSessionId); }}
            title="Interrupt Claude (Esc) without sending anything"
            style={{ padding: "10px 24px", fontSize: 14, fontWeight: 500, display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            ⎋ Stop Claude
          </button>
        ) : (
          <button
            className="glass-btn--clay"
            onClick={() => {
              if (idleSessionId) {
                const next = nextAfterAnswer(queue, idleSessionId);
                if (next) setFocus(next);
              }
            }}
            style={{ padding: "10px 24px", fontSize: 14, fontWeight: 500 }}
          >
            Acknowledge
          </button>
        )}
      </div>
    );
  }

  const sessionId = decision.sessionId;

  const handleSend = () => {
    const el = inputRef.current;
    const val = el?.value.trim();
    if (!val) return;
    if (working) {
      // A passive card is showing but Claude is still mid-turn — redirect it.
      interrupt(decision!.sessionId, val);
    } else if (decision && (decision.kind === "question" || decision.kind === "permission" || decision.kind === "mode")) {
      answer(decision.id, { custom: val });
    } else {
      instruct(decision!.sessionId, val);
    }
    if (el) { el.value = ""; el.style.height = "auto"; }
    setSent(true);
    setTimeout(() => setSent(false), 1800);
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

      <div style={{ display: "flex", gap: 9, marginTop: 11, alignItems: "flex-end", minWidth: 0 }}>
        <textarea
          ref={inputRef}
          className="reply-input no-scrollbar"
          placeholder="Type a custom reply…"
          rows={1}
          onInput={(e) => autoGrow(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          style={textareaStyle}
        />
        <button
          className="glass-btn--clay"
          onClick={handleSend}
          style={{ borderRadius: 999, padding: "0 22px", height: 44, fontSize: 13.5, fontWeight: 600, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          Send <Kbd>⌅</Kbd>
        </button>
      </div>
      {sent && (
        <span className="mono" style={{ display: "block", fontSize: 11, color: "rgb(var(--accent))", marginTop: 4 }}>✓ sent</span>
      )}

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
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          Skip ⤳ <Kbd>⌃→</Kbd>
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
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          Snooze 15m <Kbd>⌃S</Kbd>
        </span>
        {working && (
          <span
            className="glass-inset-hover"
            onClick={() => interrupt(sessionId)}
            title="Interrupt Claude (Esc) without sending anything"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "var(--text-soft)",
              border: "1px solid var(--border)",
              borderRadius: 999,
              padding: "6px 12px",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
            }}
          >
            ⎋ Stop
          </span>
        )}
        <span className="mono faint" style={{ marginLeft: "auto", fontSize: 10.5 }}>
          {working ? "send → interrupt & redirect" : "answer → auto-advance to next"}
        </span>
      </div>
    </div>
  );
}
