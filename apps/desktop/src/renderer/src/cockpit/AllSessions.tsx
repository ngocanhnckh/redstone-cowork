import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store";
import { DiscoveredSession } from "../types";
import Markdown from "./Markdown";

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function TagChips({ session }: { session: DiscoveredSession }) {
  const addTag = useStore((s) => s.inventoryAddTag);
  const removeTag = useStore((s) => s.inventoryRemoveTag);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const submit = () => { if (draft.trim()) addTag(session.id, draft); setDraft(""); setAdding(false); };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: 5 }}>
      {session.tags.map((t) => (
        <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, fontFamily: "var(--font-mono)", padding: "2px 7px", borderRadius: 999, background: "rgb(var(--primary) / 0.14)", border: "1px solid rgb(var(--primary-soft) / 0.35)" }}>
          {t}<span onClick={() => removeTag(session.id, t)} style={{ cursor: "pointer", opacity: 0.6 }}>✕</span>
        </span>
      ))}
      {adding ? (
        <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); else if (e.key === "Escape") { setDraft(""); setAdding(false); } }} onBlur={submit} placeholder="tag…" maxLength={40}
          style={{ width: 80, fontSize: 10, fontFamily: "var(--font-mono)", padding: "2px 7px", borderRadius: 999, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text)", outline: "none" }} />
      ) : (
        <button onClick={() => setAdding(true)} style={{ fontSize: 10, fontFamily: "var(--font-mono)", padding: "2px 7px", borderRadius: 999, border: "1px dashed var(--border-strong)", background: "transparent", color: "var(--text-soft)", cursor: "pointer" }}>+ tag</button>
      )}
    </span>
  );
}

function SessionDetail({ session, onClose }: { session: DiscoveredSession; onClose: () => void }) {
  const [history, setHistory] = useState<Array<{ role: string; text: string }> | null>(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [running, setRunning] = useState(false);
  const [reply, setReply] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setHistory(null);
    window.cowork.inventoryHistory(session.id)
      .then((r) => setHistory(r.ok ? r.messages ?? [] : []))
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [session.id]);

  const sendOneShot = async () => {
    if (!msg.trim() || running) return;
    setRunning(true); setReply(null);
    try {
      const r = await window.cowork.inventoryRun(session.id, msg.trim());
      setReply(r.ok ? (r.reply ?? "(no reply)") : `Error: ${r.error ?? "failed"}`);
      setMsg("");
    } finally { setRunning(false); }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="glass-soft" onClick={(e) => e.stopPropagation()} style={{ width: 760, maxWidth: "94vw", maxHeight: "86vh", borderRadius: 16, border: "1px solid var(--border-strong)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "18px 22px 12px", borderBottom: "1px solid var(--border)" }}>
          <span className="display" style={{ fontSize: 18 }}>{session.folder}</span>
          <span className="mono faint" style={{ fontSize: 11 }}>{session.machine} · {session.source} · {session.messageCount} msgs · {timeAgo(session.lastActive)}</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 8, width: 28, height: 28, cursor: "pointer" }}>✕</button>
        </div>
        <div className="mono faint" style={{ fontSize: 10.5, padding: "6px 22px 0" }}>{session.cwd}</div>

        <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "12px 22px", display: "flex", flexDirection: "column", gap: 8 }}>
          {loading ? <span className="faint" style={{ fontStyle: "italic" }}>Loading history from the host…</span>
            : history && history.length > 0 ? history.map((m, i) => (
              <div key={i} className={m.role === "assistant" ? "glass-inset" : undefined} style={{ padding: m.role === "assistant" ? "10px 13px" : "6px 2px", borderRadius: 11, fontSize: 12.5, color: "var(--text)" }}>
                <span className="mono faint" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", display: "block", marginBottom: 4, opacity: 0.55 }}>{m.role}</span>
                {m.role === "assistant" ? <Markdown>{m.text}</Markdown> : m.text}
              </div>
            )) : <span className="faint" style={{ fontStyle: "italic" }}>No history available (the host agent may be offline).</span>}
        </div>

        <div style={{ borderTop: "1px solid var(--border)", padding: "12px 22px 16px" }}>
          <div style={{ marginBottom: 8 }}><TagChips session={session} /></div>
          {reply !== null && (
            <div className="glass-inset" style={{ padding: "10px 13px", borderRadius: 11, fontSize: 12.5, marginBottom: 8 }}><Markdown>{reply}</Markdown></div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input value={msg} onChange={(e) => setMsg(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") sendOneShot(); }} placeholder="Send a one-shot message (headless, bypass permissions)…" disabled={running}
              style={{ flex: 1, border: "1px solid var(--border)", background: "transparent", borderRadius: 9, padding: "9px 12px", fontSize: 12.5, color: "var(--text)", outline: "none" }} />
            <button onClick={sendOneShot} disabled={running || !msg.trim()} className="glass-btn--clay" style={{ padding: "0 18px", borderRadius: 9, fontSize: 13, fontWeight: 600 }}>{running ? "Running…" : "Run"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AllSessions() {
  const hosts = useStore((s) => s.hosts);
  const inventory = useStore((s) => s.inventory);
  const fetchInventory = useStore((s) => s.fetchInventory);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<DiscoveredSession | null>(null);

  useEffect(() => { fetchInventory(); }, [fetchInventory]);

  // Group host → folder → sessions, honoring the search filter.
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (s: DiscoveredSession) =>
      !q || s.folder.toLowerCase().includes(q) || (s.title ?? "").toLowerCase().includes(q) || s.tags.some((t) => t.toLowerCase().includes(q));
    const byHost = new Map<string, Map<string, DiscoveredSession[]>>();
    for (const s of inventory) {
      if (!match(s)) continue;
      if (!byHost.has(s.hostId)) byHost.set(s.hostId, new Map());
      const folders = byHost.get(s.hostId)!;
      if (!folders.has(s.folder)) folders.set(s.folder, []);
      folders.get(s.folder)!.push(s);
    }
    return byHost;
  }, [inventory, query]);

  const hostName = (id: string) => hosts.find((h) => h.id === id)?.machine ?? id;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "16px 28px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        <span className="display" style={{ fontSize: 20 }}>All sessions</span>
        <span className="mono faint" style={{ fontSize: 11 }}>{inventory.length} sessions · {hosts.length} host{hosts.length === 1 ? "" : "s"}</span>
        <span style={{ flex: 1 }} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search folder, title, tag…"
          style={{ width: 260, border: "1px solid var(--border)", background: "transparent", borderRadius: 9, padding: "7px 12px", fontSize: 12.5, color: "var(--text)", outline: "none" }} />
        <button onClick={fetchInventory} title="Refresh" style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 9, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>↻</button>
      </div>

      <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 18 }}>
        {inventory.length === 0 ? (
          <div className="soft" style={{ fontSize: 13, lineHeight: 1.6, maxWidth: 560 }}>
            No sessions reported yet. Run <span className="mono">redstone agent</span> on a host (after <span className="mono">redstone update</span>) to scan <span className="mono">~/.claude/projects</span> and report all its Claude Code sessions here.
          </div>
        ) : [...grouped.entries()].map(([hostId, folders]) => (
          <div key={hostId}>
            <div className="mono" style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-soft)", marginBottom: 8 }}>💻 {hostName(hostId)}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingLeft: 6 }}>
              {[...folders.entries()].map(([folder, sessions]) => (
                <div key={folder}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>📁 {folder} <span className="faint" style={{ fontWeight: 400, fontSize: 11 }}>· {sessions.length}</span></div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 14 }}>
                    {sessions.map((s) => (
                      <div key={s.id} onClick={() => setOpen(s)} className="glass-inset-hover" style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", borderRadius: 9, cursor: "pointer" }}>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5 }}>{s.title ?? <span className="faint">(untitled session)</span>}</span>
                        {s.source === "cowork" && <span className="mono" style={{ fontSize: 9, padding: "1px 6px", borderRadius: 999, background: "rgb(var(--accent) / 0.16)", color: "rgb(var(--accent))" }}>cowork</span>}
                        {s.tags.slice(0, 3).map((t) => <span key={t} className="mono faint" style={{ fontSize: 9.5 }}>#{t}</span>)}
                        <span className="mono faint" style={{ fontSize: 10.5 }}>{s.messageCount} · {timeAgo(s.lastActive)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {open && <SessionDetail session={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
