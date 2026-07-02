import { useRef, useEffect } from "react";
import { useStore } from "../store";
import AnswerDock from "./AnswerDock";
import ContextGauge from "./ContextGauge";
import TagBar from "./TagBar";
import Markdown from "./Markdown";
import Kbd from "./Kbd";
import TerminalStack from "./TerminalStack";
import BrowserStack from "./BrowserStack";
import PortsPanel from "./PortsPanel";
import FilesPanel from "./FilesPanel";

const TABS = [
  { key: "chat", label: "Chat", hint: "⌃1" },
  { key: "terminal", label: "Terminal", hint: "⌃2" },
  { key: "browser", label: "Browser", hint: "⌃3" },
  { key: "ports", label: "Ports", hint: "⌃4" },
  { key: "files", label: "Files", hint: "⌃5" },
] as const;

const ACTIONABLE_KINDS = ["question", "permission", "mode"] as const;

function projectName(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

export default function FocusStage({ sessionId }: { sessionId?: string } = {}) {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const decisions = useStore((s) => s.decisions);
  const switchMode = useStore((s) => s.switchMode);
  const pendingMap = useStore((s) => s.pending);
  const activeTabMap = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);

  const id = sessionId ?? focusId;
  const activeTab = (id && activeTabMap[id]) || "chat";
  const session =
    sessions.find((s) => s.id === id) ?? queue.find((s) => s.id === id);

  const sessionDecisions = decisions.filter((d) => d.sessionId === id);
  const actionableDecision = sessionDecisions.find((d) =>
    (ACTIONABLE_KINDS as readonly string[]).includes(d.kind)
  );
  const decision = actionableDecision ?? sessionDecisions[0];

  // Server transcript + optimistic sends not yet incorporated by the host. The
  // optimistic copies render instantly so the user sees their message right away;
  // store pruning removes them once the transcript grows past the send.
  const transcript = session?.transcript ?? [];
  const pending = id ? pendingMap[id] ?? [] : [];
  const timeline = [
    ...transcript,
    ...pending.map((p) => ({ role: "user" as const, text: p.text })),
  ];
  // Show the "thinking" indicator from the moment the user sends until Claude's
  // final answer. Driven by the server `working` flag (true from prompt-submit
  // through tool runs, false at Stop); the optimistic `pending` check covers the
  // brief gap before the host's first push lands — pending is pruned exactly when
  // the transcript grows, which is the same push that sets `working=true`, so
  // coverage is continuous. We deliberately DON'T fall back to "last message is
  // the user": a tool-only final turn is skipped by the transcript reader, so the
  // last captured message can be the user's prompt even after Claude has stopped —
  // that would wedge the animation on forever. Only an ACTIONABLE decision (a
  // question/permission needing you) suppresses it — a leftover completion/
  // notification card must NOT hide that Claude is working.
  // A `lost` session's poller is gone, so a `working=true` left over from an
  // interrupted turn (no Stop fired to clear it) can never be trusted — force it off.
  const isWorking =
    session?.status !== "lost" && !actionableDecision && (!!session?.working || pending.length > 0);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Only auto-scroll to the bottom when the user is already near it, so a poll
  // refresh doesn't yank them back down while they're reading scrollback.
  const stickToBottom = useRef(true);
  const onBodyScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  useEffect(() => {
    if (scrollRef.current && stickToBottom.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [session?.transcript, pending.length, isWorking]);

  if (!session) return null;

  const isWaiting =
    session.status === "waiting" || decision?.kind === "permission";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        flex: 1,
      }}
    >
      {/* Stage head — compact two-row header */}
      {/* Row 1: identity + info line (left) · mode control (right, chat only) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "12px 32px 10px",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, minWidth: 0, flex: 1 }}>
          <span
            title={isWaiting ? "needs review" : session.status}
            style={{
              flexShrink: 0,
              alignSelf: "center",
              width: 8,
              height: 8,
              borderRadius: 999,
              background: isWaiting ? "rgb(var(--accent))" : "rgb(var(--primary-soft))",
              boxShadow: isWaiting ? "0 0 0 3px rgb(var(--accent) / 0.18)" : "none",
            }}
          />
          <h2
            className="display"
            style={{
              fontSize: 19,
              fontWeight: 400,
              margin: 0,
              lineHeight: 1.1,
              flexShrink: 0,
              whiteSpace: "nowrap",
            }}
          >
            {projectName(session.cwd)}
          </h2>
          <span
            className="mono faint"
            style={{
              fontSize: 11,
              letterSpacing: "0.02em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {session.machine} · {session.gitBranch ?? "no branch"}
            {session.wrapperId ? ` · tmux rcw-${session.wrapperId}` : ` · #${session.id.slice(0, 4)}`}
          </span>
          {activeTab === "chat" && <ContextGauge contextTokens={session.contextTokens} model={session.model} />}
        </div>

        {/* Mode selector — only relevant to Claude, so shown on the Chat tab */}
        {activeTab === "chat" &&
          (() => {
            // Full Shift+Tab cycle. Auto mode is a standard Claude feature, always offered.
            const modes = ["default", "acceptEdits", "plan", "auto"];
            const current = session.permissionMode ?? "default";
            const LABEL: Record<string, string> = { default: "Default", acceptEdits: "Accept Edits", plan: "Plan", auto: "Auto" };
            return (
              <div
                style={{
                  display: "flex",
                  flexShrink: 0,
                  border: "1px solid var(--border)",
                  borderRadius: 999,
                  padding: 3,
                  gap: 3,
                }}
              >
                {modes.map((m) => (
                  <button
                    key={m}
                    onClick={() => switchMode(session.id, m)}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      padding: "4px 11px",
                      borderRadius: 999,
                      border: 0,
                      cursor: "pointer",
                      background: m === current ? "rgb(var(--primary) / 0.32)" : "transparent",
                      color: m === current ? "#fff" : "var(--text-soft)",
                      transition: "background 0.15s, color 0.15s",
                    }}
                  >
                    {LABEL[m] ?? m}
                  </button>
                ))}
              </div>
            );
          })()}
      </div>

      {/* Tags — user-applied labels for this session */}
      {id && (
        <div style={{ padding: "0 32px 10px" }}>
          <TagBar sessionId={id} tags={session.tags ?? []} />
        </div>
      )}

      {/* Row 2: tab bar — primary nav, with bottom border separating header from body */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "0 32px",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {TABS.map((t) => {
          const active = activeTab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => id && setActiveTab(id, t.key)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                padding: "9px 12px",
                border: 0,
                borderBottom: active
                  ? "2px solid rgb(var(--primary-soft))"
                  : "2px solid transparent",
                marginBottom: -1,
                background: "transparent",
                cursor: "pointer",
                color: active ? "var(--text)" : "var(--text-soft)",
                transition: "color 0.15s, border-color 0.15s",
              }}
            >
              {t.label}
              <Kbd>{t.hint}</Kbd>
            </button>
          );
        })}
      </div>

      {activeTab === "terminal" ? (
        // Terminals live in a persistent, keep-alive stack (below) so they never
        // reload/recreate on tab/session switch. Nothing renders here.
        null
      ) : activeTab === "browser" ? (
        // The browser lives in a persistent, keep-alive stack (below) so it never
        // reloads on tab/session switch — like a Chrome tab. Nothing renders here.
        null
      ) : activeTab === "ports" ? (
        <PortsPanel
          key={`${id}-ports`}
          sessionId={id ?? ""}
          cwd={session.cwd}
          machine={session.machine}
        />
      ) : activeTab === "files" ? (
        <FilesPanel
          key={`${id}-files`}
          sessionId={id ?? ""}
          cwd={session.cwd}
          machine={session.machine}
        />
      ) : (
      <>
      {/* Body — transcript scrollback */}
      <div
        ref={scrollRef}
        onScroll={onBodyScroll}
        className="no-scrollbar"
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "18px 32px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {timeline.length > 0 ? (
          timeline.map((msg, i) =>
            msg.role === "assistant" ? (
              <div
                key={i}
                className="glass-inset"
                style={{
                  padding: "13px 16px",
                  borderRadius: 13,
                  color: "var(--text)",
                }}
              >
                <span
                  style={{
                    display: "block",
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "var(--text-soft)",
                    marginBottom: 8,
                    opacity: 0.6,
                  }}
                >
                  claude
                </span>
                <Markdown>{msg.text}</Markdown>
              </div>
            ) : (
              <div
                key={i}
                style={{
                  padding: "8px 4px",
                  fontSize: 13,
                  lineHeight: 1.5,
                  whiteSpace: "pre-wrap",
                  color: "var(--text)",
                }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    fontFamily: "var(--font-mono)",
                    fontSize: 9,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: "var(--text-soft)",
                    marginBottom: 4,
                    opacity: 0.5,
                  }}
                >
                  you
                </span>
                {msg.text}
              </div>
            )
          )
        ) : session.latestAnswer ? (
          <div
            className="glass-inset"
            style={{ padding: "13px 16px", borderRadius: 13, color: "var(--text)" }}
          >
            <Markdown>{session.latestAnswer}</Markdown>
          </div>
        ) : (
          <span className="faint" style={{ fontSize: 14, fontStyle: "italic" }}>
            Waiting for output…
          </span>
        )}

        {isWorking && (
          <div className="thinking-card">
            <span className="ai-core" />
            <span className="eq">
              {[0, 1, 2, 3, 4].map((i) => (
                <span key={i} className="eq-bar" style={{ animationDelay: `${i * 0.13}s` }} />
              ))}
            </span>
            <span
              className="shimmer"
              style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, letterSpacing: "0.04em", position: "relative" }}
            >
              Claude is working — more on the way…
            </span>
          </div>
        )}
      </div>

      {/* Answer dock pinned at bottom */}
      <AnswerDock decision={decision} working={isWorking} sessionId={id ?? undefined} />
      </>
      )}

      {/* Keep-alive layers: browsers and terminals for every opened session stay
          mounted (shown only for the focused session on their tab) so they never
          reload/recreate on tab/session switch. */}
      <BrowserStack activeId={id} active={activeTab === "browser"} />
      <TerminalStack activeId={id} active={activeTab === "terminal"} />
    </div>
  );
}
