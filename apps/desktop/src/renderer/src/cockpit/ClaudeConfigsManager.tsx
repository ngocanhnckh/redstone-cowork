import { useEffect, useState } from "react";

/**
 * Manage named Claude endpoint/model profiles stored on the cowork server. Each
 * profile is a set of env vars (e.g. ANTHROPIC_MODEL, ANTHROPIC_BASE_URL,
 * ANTHROPIC_AUTH_TOKEN) that `redstone --config="<name>" claude` injects into the
 * Claude session — the supported way to point Claude Code at a custom model or
 * gateway (exported shell vars don't reach the tmux-hosted session). Values are
 * encrypted at rest and only fetched by name over the authed channel.
 */

type Row = { k: string; v: string };
// Handy keys to seed / quick-add — the ones people set most often.
const COMMON_KEYS = ["ANTHROPIC_MODEL", "ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_SMALL_FAST_MODEL"];

const inputStyle: React.CSSProperties = {
  border: "1px solid var(--border)", background: "rgba(255,255,255,0.03)", borderRadius: 8,
  padding: "7px 10px", fontSize: 12, color: "var(--text)", outline: "none", fontFamily: "var(--font-mono)",
};

export default function ClaudeConfigsManager() {
  const [names, setNames] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null); // profile being edited (null = editor closed)
  const [draftName, setDraftName] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = () => { window.cowork.listClaudeConfigs().then((l) => setNames(l.map((x) => x.name).sort())).catch(() => {}); };
  useEffect(load, []);

  const startNew = () => { setEditing(""); setDraftName(""); setRows([{ k: "ANTHROPIC_MODEL", v: "" }]); setStatus(null); };
  const startEdit = async (name: string) => {
    setStatus(null);
    try {
      const p = await window.cowork.getClaudeConfig(name);
      const r = Object.entries(p.env ?? {}).map(([k, v]) => ({ k, v }));
      setEditing(name); setDraftName(name); setRows(r.length ? r : [{ k: "", v: "" }]);
    } catch { setStatus({ kind: "err", text: "could not load profile" }); }
  };
  const cancel = () => { setEditing(null); setStatus(null); };

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = (k = "") => setRows((rs) => [...rs, { k, v: "" }]);
  const removeRow = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const save = async () => {
    const name = draftName.trim();
    if (!name || busy) return;
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) { setStatus({ kind: "err", text: "name must be a slug ([a-zA-Z0-9._-])" }); return; }
    const env: Record<string, string> = {};
    for (const { k, v } of rows) {
      const key = k.trim();
      if (!key) continue;
      if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) { setStatus({ kind: "err", text: `bad env key: ${key}` }); return; }
      env[key] = v;
    }
    if (Object.keys(env).length === 0) { setStatus({ kind: "err", text: "add at least one env var" }); return; }
    setBusy(true); setStatus(null);
    try {
      await window.cowork.putClaudeConfig(name, env);
      setStatus({ kind: "ok", text: "✓ saved" });
      setEditing(name);
      load();
    } catch { setStatus({ kind: "err", text: "save failed" }); }
    finally { setBusy(false); }
  };
  const del = async (name: string) => {
    setBusy(true);
    try { await window.cowork.deleteClaudeConfig(name); if (editing === name) setEditing(null); load(); }
    finally { setBusy(false); }
  };

  const copy = (text: string, id: string) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(id); setTimeout(() => setCopied((c) => (c === id ? null : c)), 1200); }).catch(() => {});
  };

  const runCmd = (name: string) => `redstone --config="${name}" claude`;

  return (
    <div style={{ marginTop: 24, paddingTop: 18, borderTop: "1px solid var(--border)" }}>
      <span className="kicker">Claude models</span>
      <h2 className="display" style={{ fontSize: 20, margin: "2px 0 4px" }}>Custom model / endpoint profiles</h2>
      <p className="faint" style={{ fontSize: 11.5, margin: "0 2px 12px", lineHeight: 1.55 }}>
        A profile is a set of env vars (e.g. <code className="mono">ANTHROPIC_MODEL</code>, <code className="mono">ANTHROPIC_BASE_URL</code>,{" "}
        <code className="mono">ANTHROPIC_AUTH_TOKEN</code>) that get injected into a Claude Code session. Point Claude at a custom model
        or gateway here, then launch it with the command shown below. Values are stored encrypted on the cowork server.
      </p>

      {/* Profile list */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
        {names.length === 0 && <span className="faint" style={{ fontSize: 12, fontStyle: "italic" }}>No profiles yet.</span>}
        {names.map((n) => (
          <div key={n} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
            <span className="mono" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: editing === n ? "rgb(var(--primary-soft))" : "var(--text)" }}>{n}</span>
            <button onClick={() => copy(runCmd(n), `run-${n}`)} title="Copy run command" className="mono" style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 6, padding: "2px 8px", fontSize: 10.5, cursor: "pointer" }}>
              {copied === `run-${n}` ? "copied" : "copy run"}
            </button>
            <button onClick={() => startEdit(n)} style={{ border: 0, background: "transparent", color: "rgb(var(--primary-soft))", cursor: "pointer", fontSize: 11.5 }}>edit</button>
            <button onClick={() => del(n)} disabled={busy} style={{ border: 0, background: "transparent", color: "#e0736a", cursor: "pointer", fontSize: 11.5 }}>delete</button>
          </div>
        ))}
      </div>

      {editing === null ? (
        <button onClick={startNew} className="glass-btn--clay" style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 600 }}>+ New profile</button>
      ) : (
        <div className="glass-inset" style={{ padding: 12, borderRadius: 10, marginTop: 4 }}>
          <label className="soft" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>Profile name</label>
          <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="e.g. synthetic, glm, kimi"
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 10 }} />

          <label className="soft" style={{ fontSize: 11, display: "block", marginBottom: 4 }}>Environment variables</label>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((r, i) => (
              <div key={i} style={{ display: "flex", gap: 6 }}>
                <input value={r.k} onChange={(e) => setRow(i, { k: e.target.value.toUpperCase() })} placeholder="KEY" style={{ ...inputStyle, flex: "0 0 44%" }} />
                <input value={r.v} onChange={(e) => setRow(i, { v: e.target.value })} placeholder="value" style={{ ...inputStyle, flex: 1, minWidth: 0 }} />
                <button onClick={() => removeRow(i)} title="Remove" style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-faint)", borderRadius: 7, padding: "0 9px", cursor: "pointer", fontSize: 12 }}>✕</button>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
            <button onClick={() => addRow()} className="mono" style={{ border: "1px dashed var(--border-strong)", background: "transparent", color: "var(--text-soft)", borderRadius: 7, padding: "3px 9px", fontSize: 10.5, cursor: "pointer" }}>+ row</button>
            {COMMON_KEYS.filter((k) => !rows.some((r) => r.k === k)).map((k) => (
              <button key={k} onClick={() => addRow(k)} className="mono" style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-faint)", borderRadius: 7, padding: "3px 9px", fontSize: 10.5, cursor: "pointer" }}>+ {k}</button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
            <button onClick={save} disabled={busy || !draftName.trim()} className="glass-btn--clay" style={{ padding: "7px 16px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, opacity: draftName.trim() ? 1 : 0.5 }}>{busy ? "…" : "Save profile"}</button>
            <button onClick={cancel} style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, cursor: "pointer" }}>Cancel</button>
            {status && <span className="mono" style={{ fontSize: 11, color: status.kind === "ok" ? "rgb(var(--accent))" : "#e0736a" }}>{status.text}</span>}
          </div>

          {draftName.trim() && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
              <div className="faint" style={{ fontSize: 10.5, marginBottom: 5 }}>Run Claude with this profile (on the host machine):</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code className="mono glass-inset" style={{ flex: 1, minWidth: 0, padding: "7px 10px", borderRadius: 8, fontSize: 11.5, color: "rgb(var(--accent))", overflowX: "auto", whiteSpace: "nowrap" }}>{runCmd(draftName.trim())}</code>
                <button onClick={() => copy(runCmd(draftName.trim()), "run-draft")} className="mono" style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 6, padding: "5px 9px", fontSize: 10.5, cursor: "pointer", flexShrink: 0 }}>{copied === "run-draft" ? "copied" : "copy"}</button>
              </div>
              <div className="faint" style={{ fontSize: 10.5, marginTop: 6, lineHeight: 1.6 }}>
                Add <code className="mono">--resume</code> to reattach an existing session. Manage the same profiles from the CLI with{" "}
                <code className="mono">redstone config set {draftName.trim() || "&lt;name&gt;"} KEY=VAL</code>, <code className="mono">config list</code>, <code className="mono">config get</code>, <code className="mono">config rm</code>.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
