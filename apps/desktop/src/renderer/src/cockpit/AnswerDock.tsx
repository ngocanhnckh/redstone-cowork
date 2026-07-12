import { useRef, useState, useEffect } from "react";
import { Decision } from "../types";
import { useStore } from "../store";
import { nextWaiting } from "../autoAdvance";
import { commandsFor } from "./caps";
import SlashTextarea from "./SlashTextarea";
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
  // Answering state: which option is in flight, an error if a resolve failed, and
  // the per-question picks for a multi-question / multiSelect form.
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string | string[]>>({});
  const answer = useStore((s) => s.answer);
  const snooze = useStore((s) => s.snooze);
  const setFocus = useStore((s) => s.setFocus);
  const focusId = useStore((s) => s.focusId);
  const queue = useStore((s) => s.queue);
  const decisions = useStore((s) => s.decisions);
  const instruct = useStore((s) => s.instruct);
  const interrupt = useStore((s) => s.interrupt);
  const sessions = useStore((s) => s.sessions);
  const caps = useStore((s) => s.caps);
  const mode = useStore((s) => s.mode);
  const idleSessionId = sessionIdProp ?? focusId;
  // Slash-command suggestions for the focused session's host.
  const machine = (sessions.find((s) => s.id === (decision?.sessionId ?? idleSessionId)) ?? queue.find((s) => s.id === (decision?.sessionId ?? idleSessionId)))?.machine;
  const commands = commandsFor(caps, machine);

  // Reset the answering state whenever the shown decision changes, so picks/errors
  // from a previous question never leak into the next one.
  useEffect(() => {
    setPicks({});
    setSubmitErr(null);
    setSubmitting(false);
  }, [decision?.id]);

  // Skip (Ctrl+→) and Snooze (Ctrl+S) shortcuts — only active while a decision is shown.
  useEffect(() => {
    if (!decision) return;
    const sid = decision.sessionId;
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        const next = nextWaiting(queue, decisions, sid);
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
      // Send never interrupts — it just queues the message, exactly like typing in
      // Claude Code during a turn. Only the Stop button aborts (see below).
      instruct(idleSessionId, val);
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
          <SlashTextarea
            ref={idleInputRef}
            commands={commands}
            className="reply-input no-scrollbar"
            placeholder={working ? "Queue a message for Claude…  (/ for commands)" : "Send an instruction…  (/ for commands)"}
            onSubmit={submitIdle}
            style={textareaStyle}
          />
          <button
            className="glass-btn--clay"
            onClick={submitIdle}
            style={{ borderRadius: 999, padding: "0 22px", height: 44, fontSize: 13.5, fontWeight: 600, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 8 }}
          >
            Send <Kbd>⌅</Kbd>
          </button>
        </div>
        {idleSent && (
          <span className="mono" style={{ display: "block", fontSize: 11, color: "rgb(var(--accent))", marginBottom: 6 }}>✓ sent</span>
        )}
        {working ? (
          <button
            className="glass-btn--clay"
            onClick={() => { if (idleSessionId) interrupt(idleSessionId); }}
            title="Stop Claude — interrupt (Esc) without sending anything"
            aria-label="Stop Claude"
            style={{ width: 34, height: 34, borderRadius: 999, padding: 0, fontSize: 12, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            ◼
          </button>
        ) : mode !== "hud" ? (
          // Advance-to-next affordance for the full cockpit; pointless in the compact
          // HUD (which just needs the reply box), so it's hidden there.
          <button
            className="glass-btn--clay"
            onClick={() => {
              if (idleSessionId) {
                const next = nextWaiting(queue, decisions, idleSessionId);
                if (next) setFocus(next);
              }
            }}
            style={{ padding: "10px 24px", fontSize: 14, fontWeight: 500 }}
          >
            Acknowledge
          </button>
        ) : null}
      </div>
    );
  }

  const sessionId = decision.sessionId;

  // The question(s) Claude is asking. For AskUserQuestion these live in the tool
  // input (not any assistant message), so without this the dock showed options with
  // no prompt. Fall back to the decision title (a permission prompt, or a question
  // with no structured body).
  type Q = { question: string; multiSelect?: boolean; options?: Array<{ label: string; description?: string }> };
  const questions: Q[] =
    (decision.body?.tool_input as { questions?: Q[] } | undefined)?.questions ?? [];

  // A single single-select question can be answered with one click (posts {choice},
  // which the keymap drives as digit+Enter). Anything richer — MULTIPLE questions or
  // ANY multiSelect — needs a form that collects a complete `answers` map, otherwise
  // the keymap can't drive the whole form and the agent hangs waiting for the final
  // submit. (This was the "selected but never submitted all answers" bug.)
  const needsForm = questions.length > 1 || questions.some((q) => q.multiSelect);

  // Resolve the decision, showing a transient "sending…" state and surfacing a
  // failure (instead of a card that silently sits showing options forever).
  const submit = async (resolution: { choice?: string; answers?: Record<string, string | string[]>; custom?: string }) => {
    if (submitting) return;
    setSubmitErr(null);
    setSubmitting(true);
    const ok = await answer(decision.id, resolution);
    // On success the decision is removed from the store → this dock unmounts, so we
    // only need to recover on failure.
    if (!ok) { setSubmitErr("Couldn't send your answer — check the connection and try again."); setSubmitting(false); }
  };

  const setSingle = (q: string, label: string) => setPicks((p) => ({ ...p, [q]: label }));
  const toggleMulti = (q: string, label: string) => setPicks((p) => {
    const cur = Array.isArray(p[q]) ? (p[q] as string[]) : [];
    return { ...p, [q]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
  });
  const isPicked = (q: string, label: string) => {
    const v = picks[q];
    return Array.isArray(v) ? v.includes(label) : v === label;
  };
  const formComplete = questions.every((q) => {
    const v = picks[q.question];
    return q.multiSelect ? Array.isArray(v) && v.length > 0 : typeof v === "string" && !!v;
  });

  const handleSend = () => {
    const el = inputRef.current;
    const val = el?.value.trim();
    if (!val) return;
    if (decision && (decision.kind === "question" || decision.kind === "permission" || decision.kind === "mode")) {
      submit({ custom: val });
    } else {
      // Otherwise just queue the message (never interrupts) — only Stop aborts.
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
      {needsForm ? (
        /* Multiple questions and/or multiSelect → a full form. Each question shows
           its own options; picks are collected and submitted together as an
           `answers` map so the keymap drives the whole form and its final submit. */
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {questions.map((q, qi) => (
            <div key={qi}>
              <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.45, color: "var(--text)" }}>
                <span className="mono faint" style={{ fontSize: 11, marginRight: 6 }}>{qi + 1}.</span>
                {q.question}
              </div>
              {q.multiSelect && <div className="mono faint" style={{ fontSize: 10, margin: "2px 0 4px" }}>select all that apply</div>}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                {(q.options ?? []).map((opt, oi) => {
                  const on = isPicked(q.question, opt.label);
                  return (
                    <div
                      key={oi}
                      className={on ? "glass-inset" : "glass-inset glass-inset-hover"}
                      onClick={() => (q.multiSelect ? toggleMulti(q.question, opt.label) : setSingle(q.question, opt.label))}
                      style={{
                        display: "flex", alignItems: "center", gap: 11, padding: "10px 13px", borderRadius: 12, cursor: "pointer",
                        background: on ? "rgba(var(--primary), 0.18)" : undefined,
                        boxShadow: on ? "inset 0 0 0 1px rgb(var(--primary-soft) / 0.5)" : undefined,
                      }}
                    >
                      <span style={{
                        width: 16, height: 16, flexShrink: 0, borderRadius: q.multiSelect ? 4 : 999,
                        border: `1px solid ${on ? "rgb(var(--primary-soft))" : "var(--border-strong)"}`,
                        background: on ? "rgb(var(--primary-soft))" : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff",
                      }}>{on ? "✓" : ""}</span>
                      <span style={{ fontSize: 13.5, fontWeight: 500 }}>{opt.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <button
            className="glass-btn--clay"
            disabled={!formComplete || submitting}
            onClick={() => submit({ answers: picks })}
            style={{ alignSelf: "flex-start", padding: "9px 20px", fontSize: 13.5, fontWeight: 600, opacity: !formComplete || submitting ? 0.55 : 1, cursor: !formComplete || submitting ? "default" : "pointer" }}
          >
            {submitting ? "sending…" : "Submit answers"}
          </button>
        </div>
      ) : (
        <>
          {/* Single question — its prompt, then one-click options. */}
          <div style={{ marginBottom: 12, fontSize: 14, fontWeight: 600, lineHeight: 1.45, color: "var(--text)" }}>
            {questions[0]?.question ?? decision.title}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {decision.options.map((opt, i) => (
              <div
                key={i}
                className={i === 0 ? "glass-inset" : "glass-inset glass-inset-hover"}
                onClick={() => submit({ choice: opt.label })}
                style={{
                  display: "flex", alignItems: "center", gap: 13, padding: "12px 15px", borderRadius: 13,
                  cursor: submitting ? "wait" : "pointer", opacity: submitting ? 0.7 : 1,
                  background: i === 0 ? `rgba(var(--primary), 0.15)` : undefined,
                  boxShadow: i === 0 ? `inset 0 0 0 1px rgb(var(--primary-soft) / 0.45)` : undefined,
                }}
              >
                <span className="mono faint" style={{ fontSize: 11, border: "1px solid var(--border)", borderRadius: 6, padding: "2px 7px" }}>
                  {i + 1}
                </span>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{opt.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {submitErr && (
        <div className="mono" style={{ fontSize: 11, color: "#e0736a", marginTop: 8 }}>{submitErr}</div>
      )}

      <div style={{ display: "flex", gap: 9, marginTop: 11, alignItems: "flex-end", minWidth: 0 }}>
        <SlashTextarea
          ref={inputRef}
          commands={commands}
          className="reply-input no-scrollbar"
          placeholder="Type a custom reply…  (/ for commands)"
          onSubmit={handleSend}
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
            const next = nextWaiting(queue, decisions, sessionId);
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
          {working ? "send → queue · Stop → interrupt" : mode === "flow" ? "answer → auto-advance to next" : "answer → resolves this session"}
        </span>
      </div>
    </div>
  );
}
