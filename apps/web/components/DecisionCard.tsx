"use client";
import { useState } from "react";

type Option = { label: string; description?: string };
export type Decision = {
  id: string;
  sessionId: string;
  kind: string;
  title: string;
  options: Option[];
  createdAt: string;
  body?: Record<string, unknown>;
};

type Question = { question: string; options?: Option[]; multiSelect?: boolean };

export function DecisionCard({ decision, onResolved }: { decision: Decision; onResolved: (id: string) => void }) {
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [replying, setReplying] = useState(false);
  // question form state: question text -> chosen label (single-select) or labels (multiSelect)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});

  const deliverable = decision.body?.deliverable !== false;

  // Latest prose Claude sent, captured from the session transcript — context for
  // what you're being asked. Shown truncated with a Show more / less toggle.
  const lastMessage = typeof decision.body?.lastMessage === "string" ? decision.body.lastMessage.trim() : "";
  const COLLAPSE_AT = 220;
  const isLong = lastMessage.length > COLLAPSE_AT;
  const shownMessage = expanded || !isLong ? lastMessage : lastMessage.slice(0, COLLAPSE_AT).trimEnd() + "…";

  // AskUserQuestion can carry up to 4 questions (each single- or multi-select);
  // the hook stores them all in body. Drive the whole form, not just question 1.
  const questions = (decision.body?.tool_input as { questions?: Question[] } | undefined)?.questions;
  const isForm = decision.kind === "question" && Array.isArray(questions) && questions.length >= 1;
  const answered = (q: Question) => {
    const a = answers[q.question];
    return Array.isArray(a) ? a.length > 0 : Boolean(a);
  };
  const isPicked = (q: Question, label: string) => {
    const a = answers[q.question];
    return Array.isArray(a) ? a.includes(label) : a === label;
  };
  const toggle = (q: Question, label: string) =>
    setAnswers((prev) => {
      if (q.multiSelect) {
        const cur = Array.isArray(prev[q.question]) ? (prev[q.question] as string[]) : [];
        return { ...prev, [q.question]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label] };
      }
      return { ...prev, [q.question]: label };
    });
  const allAnswered = isForm && questions!.every(answered);

  const resolve = async (choice: string | null, answerMap: Record<string, string | string[]> | null = null) => {
    setBusy(true);
    const r = await fetch(`/api/proxy/decisions/${decision.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice, answers: answerMap, custom: custom || null }),
    });
    if (r.ok || r.status === 409) onResolved(decision.id);
    setBusy(false);
  };

  // Reply to a notification/completion: send the text into the session as an
  // instruction (delivered to Claude as keystrokes), then ack this card so it
  // leaves the queue.
  const reply = async () => {
    if (!custom.trim()) return;
    setBusy(true);
    await fetch(`/api/proxy/sessions/${decision.sessionId}/instruct`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: custom }),
    });
    const r = await fetch(`/api/proxy/decisions/${decision.id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ choice: "Replied", answers: null, custom }),
    });
    if (r.ok || r.status === 409) onResolved(decision.id);
    setBusy(false);
  };

  const card: React.CSSProperties = {
    background: "#131a2e",
    border: "1px solid #233052",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  };

  return (
    <div style={card}>
      <div style={{ fontSize: 12, opacity: 0.6 }}>
        {decision.kind} · session {decision.sessionId.slice(0, 8)} · {new Date(decision.createdAt).toLocaleTimeString()}
      </div>
      {lastMessage && (
        <div
          style={{
            margin: "8px 0",
            padding: "8px 10px",
            borderLeft: "3px solid #2a3550",
            background: "#0e1424",
            borderRadius: 6,
            fontSize: 12.5,
            lineHeight: 1.5,
            color: "rgba(255,255,255,0.75)",
            whiteSpace: "pre-wrap",
          }}
        >
          {shownMessage}
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              style={{
                display: "block",
                marginTop: 4,
                padding: 0,
                border: 0,
                background: "none",
                color: "#3b82f6",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
      )}
      <div style={{ margin: "8px 0", fontWeight: 600 }}>{decision.title}</div>
      {isForm ? (
        <>
          {!deliverable && (
            <p style={{ fontSize: 12, opacity: 0.6, margin: "0 0 8px", fontStyle: "italic" }}>
              attach via redstone-claude to answer remotely
            </p>
          )}
          {questions!.map((q, qi) => (
            <div key={qi} style={{ margin: "0 0 14px" }}>
              <div style={{ fontSize: 13, opacity: 0.85, margin: "0 0 6px" }}>
                {qi + 1}. {q.question}
                {q.multiSelect && (
                  <span style={{ fontSize: 11, opacity: 0.5 }}> · select all that apply</span>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {(q.options ?? []).map((o) => {
                  const picked = isPicked(q, o.label);
                  return (
                    <button
                      key={o.label}
                      disabled={busy || !deliverable}
                      onClick={() => toggle(q, o.label)}
                      title={o.description}
                      style={{
                        padding: "8px 14px",
                        borderRadius: 8,
                        border: picked ? "2px solid #3b6ef6" : "1px solid #2a3550",
                        background: picked ? "#1d3a7a" : "#0e1424",
                        color: "white",
                        opacity: !deliverable ? 0.5 : 1,
                        cursor: !deliverable ? "not-allowed" : "pointer",
                      }}
                    >
                      {q.multiSelect ? `${picked ? "☑" : "☐"} ${o.label}` : o.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <button
            disabled={busy || !deliverable || !allAnswered}
            onClick={() => resolve(null, answers)}
            style={{
              padding: "10px 18px",
              borderRadius: 8,
              border: 0,
              background: !deliverable || !allAnswered ? "#2a3550" : "#3b6ef6",
              color: "white",
              opacity: !deliverable || !allAnswered ? 0.5 : 1,
              cursor: busy || !deliverable || !allAnswered ? "not-allowed" : "pointer",
            }}
          >
            {allAnswered
              ? "Submit answers"
              : questions!.length > 1
                ? `Answer all ${questions!.length} questions`
                : "Pick an answer"}
          </button>
        </>
      ) : decision.kind === "permission" || decision.kind === "question" ? (
        <>
          {!deliverable && (
            <p style={{ fontSize: 12, opacity: 0.6, margin: "0 0 8px", fontStyle: "italic" }}>
              attach via redstone-claude to answer remotely
            </p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {decision.options.map((o) => (
              <button
                key={o.label}
                disabled={busy || !deliverable}
                onClick={() => resolve(o.label)}
                title={o.description}
                style={{
                  padding: "10px 18px",
                  borderRadius: 8,
                  border: 0,
                  background: !deliverable ? "#2a3550" : o.label === "Deny" ? "#5a2330" : "#3b6ef6",
                  color: "white",
                  opacity: !deliverable ? 0.5 : 1,
                  cursor: !deliverable ? "not-allowed" : "pointer",
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
          {deliverable && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                placeholder="Custom reply…"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #2a3550", background: "#0e1424", color: "inherit" }}
              />
              <button
                disabled={busy || !custom}
                onClick={() => resolve(null)}
                style={{ padding: "10px 16px", borderRadius: 8, border: 0, background: "#2a3550", color: "white", cursor: busy || !custom ? "not-allowed" : "pointer" }}
              >
                Send
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              disabled={busy}
              onClick={() => resolve("Acknowledged")}
              style={{ padding: "8px 16px", borderRadius: 8, border: 0, background: "#2a3550", color: "white", cursor: busy ? "not-allowed" : "pointer" }}
            >
              Acknowledge
            </button>
            <button
              disabled={busy}
              onClick={() => setReplying((v) => !v)}
              style={{ padding: "8px 16px", borderRadius: 8, border: "1px solid #2a3550", background: replying ? "#1d3a7a" : "transparent", color: "white", cursor: busy ? "not-allowed" : "pointer" }}
            >
              Reply
            </button>
          </div>
          {replying && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                autoFocus
                placeholder="Type a reply to Claude…"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && reply()}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #2a3550", background: "#0e1424", color: "inherit" }}
              />
              <button
                disabled={busy || !custom.trim()}
                onClick={reply}
                style={{ padding: "10px 16px", borderRadius: 8, border: 0, background: "#3b6ef6", color: "white", cursor: busy || !custom.trim() ? "not-allowed" : "pointer" }}
              >
                Send
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
