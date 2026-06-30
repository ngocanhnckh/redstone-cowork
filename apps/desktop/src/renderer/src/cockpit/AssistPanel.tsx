import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import Markdown from "./Markdown";
import Kbd from "./Kbd";

type Msg = { role: "user" | "assistant"; text: string; error?: boolean };
type Mode = "chat" | "optimize";

/**
 * Slide-over LLM assistant scoped to the focused session's conversation:
 * free chat, prompt optimization, and one-tap summarize. Calls go through the
 * cowork server (keys live server-side).
 */
export default function AssistPanel() {
  const open = useStore((s) => s.assistOpen);
  const toggle = useStore((s) => s.toggleAssist);
  const refresh = useStore((s) => s.refresh);
  const focusId = useStore((s) => s.focusId);
  const detailId = useStore((s) => s.detailId);
  const sessionId = detailId ?? focusId;

  const [models, setModels] = useState<LlmModelInfo[] | null>(null);
  const [modelId, setModelId] = useState<string>("");
  const [mode, setMode] = useState<Mode>("chat");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load the configured models once the panel first opens.
  useEffect(() => {
    if (!open || models) return;
    window.cowork
      .getLlmModels()
      .then((m) => {
        setModels(m);
        if (m[0]) setModelId((cur) => cur || (m.find((x) => x.id === "flash")?.id ?? m[0].id));
      })
      .catch(() => setModels([]));
  }, [open, models]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [msgs, busy]);

  async function run(kind: "chat" | "optimize" | "summarize", text?: string) {
    if (!sessionId || busy) return;
    const label =
      kind === "summarize" ? "Summarize the session" : kind === "optimize" ? `Optimize: ${text}` : text ?? "";
    setMsgs((m) => [...m, { role: "user", text: label }]);
    setBusy(true);
    try {
      const reply = await window.cowork.llmAssist({ sessionId, kind, modelId: modelId || undefined, input: text });
      setMsgs((m) => [...m, { role: "assistant", text: reply }]);
      if (kind === "summarize") refresh(); // ContextColumn picks up the new summary
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const friendly = /503/.test(msg) ? "No LLM models configured on the server." : msg;
      setMsgs((m) => [...m, { role: "assistant", text: `⚠ ${friendly}`, error: true }]);
    } finally {
      setBusy(false);
    }
  }

  function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    run(mode, text);
  }

  const noModels = models != null && models.length === 0;

  return (
    <>
      {/* scrim */}
      <div
        onClick={toggle}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 40,
          background: "rgba(0,0,0,0.32)",
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 0.22s ease",
        }}
      />
      <div
        className="glass-soft"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100vh",
          width: 400,
          maxWidth: "92vw",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid var(--border-strong)",
          transform: open ? "translateX(0)" : "translateX(105%)",
          transition: "transform 0.26s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 18px 12px", borderBottom: "1px solid var(--border)" }}>
          <span className="ai-core" style={{ width: 13, height: 13 }} />
          <span className="display" style={{ fontSize: 18 }}>Assistant</span>
          <span style={{ flex: 1 }} />
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="mono"
            style={{
              background: "rgba(255,255,255,0.05)",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "4px 8px",
              fontSize: 10.5,
              outline: "none",
            }}
          >
            {(models ?? []).map((m) => (
              <option key={m.id} value={m.id} style={{ background: "var(--app-panel)" }}>
                {m.label}
              </option>
            ))}
            {!models && <option>loading…</option>}
            {noModels && <option>no models</option>}
          </select>
          <button onClick={toggle} title="Close (⌃J)" style={iconBtn}>✕</button>
        </div>

        {/* Quick actions */}
        <div style={{ display: "flex", gap: 7, padding: "10px 18px", borderBottom: "1px solid var(--border)" }}>
          <button onClick={() => run("summarize")} disabled={busy || !sessionId} style={chip}>✦ Summarize</button>
          <button
            onClick={() => setMode((m) => (m === "optimize" ? "chat" : "optimize"))}
            style={{ ...chip, background: mode === "optimize" ? "rgb(var(--primary) / 0.28)" : chip.background, color: mode === "optimize" ? "#fff" : chip.color }}
          >
            ✎ Optimize prompt
          </button>
        </div>

        {/* Conversation */}
        <div ref={scrollRef} className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          {msgs.length === 0 && (
            <div className="faint" style={{ fontSize: 12.5, lineHeight: 1.6, fontStyle: "italic" }}>
              {noModels
                ? "No LLM models configured on the server. Add OPENAI_* keys to the server .env."
                : "Ask about this session, optimize a prompt before sending it, or summarize what's happened. Grounded in the current conversation."}
            </div>
          )}
          {msgs.map((m, i) =>
            m.role === "assistant" ? (
              <div key={i} className="glass-inset" style={{ padding: "11px 13px", borderRadius: 12, color: m.error ? "#e0736a" : "var(--text)" }}>
                <Markdown>{m.text}</Markdown>
              </div>
            ) : (
              <div key={i} style={{ alignSelf: "flex-end", maxWidth: "88%", padding: "9px 13px", borderRadius: 12, background: "rgb(var(--primary) / 0.18)", color: "var(--text)", fontSize: 13, whiteSpace: "pre-wrap" }}>
                {m.text}
              </div>
            )
          )}
          {busy && (
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--text-soft)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
              <span className="eq" style={{ height: 12 }}>
                {[0, 1, 2, 3].map((i) => <span key={i} className="eq-bar" style={{ animationDelay: `${i * 0.13}s` }} />)}
              </span>
              thinking…
            </div>
          )}
        </div>

        {/* Composer */}
        <div style={{ padding: "12px 16px 16px", borderTop: "1px solid var(--border)" }}>
          {mode === "optimize" && (
            <div className="mono" style={{ fontSize: 10, color: "rgb(var(--primary-soft))", marginBottom: 6 }}>
              optimize mode — type a draft instruction to improve
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <textarea
              className="reply-input no-scrollbar"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={mode === "optimize" ? "Draft instruction…" : "Ask about this session…"}
              rows={1}
              disabled={noModels}
              style={{
                flex: 1, minWidth: 0, borderRadius: 12, border: "1px solid var(--border)", padding: "10px 13px",
                color: "var(--text)", caretColor: "rgb(var(--primary-soft))", fontSize: 13,
                background: "rgba(255,255,255,0.03)", outline: "none", resize: "none", maxHeight: 120,
                fontFamily: "var(--font-body)", boxSizing: "border-box", overflowWrap: "anywhere",
              }}
            />
            <button className="glass-btn--clay" onClick={send} disabled={busy || noModels} style={{ borderRadius: 999, padding: "0 18px", height: 42, fontSize: 13, fontWeight: 600, flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 7 }}>
              Send <Kbd>⌅</Kbd>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

const iconBtn: React.CSSProperties = {
  border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)",
  borderRadius: 8, width: 26, height: 26, cursor: "pointer", fontSize: 12,
};
const chip: React.CSSProperties = {
  border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)",
  borderRadius: 999, padding: "5px 13px", fontSize: 11.5, fontFamily: "var(--font-mono)", cursor: "pointer",
};
