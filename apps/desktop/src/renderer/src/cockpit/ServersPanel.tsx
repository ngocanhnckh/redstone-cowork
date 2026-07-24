import { useCallback, useEffect, useState } from "react";
import type { ServerView } from "../../../shared/servers";

// ——— SERVER REGISTRY — machines agents can open sessions on ———
// Admin registers company servers and assigns them to agents; agents see the servers
// they're granted plus any VPS they self-add. A self-added VPS is theirs to manage.

const CSS = `
.rcw-sv { height:100%; min-height:0; display:flex; flex-direction:column; font-family:var(--font-mono); }
.rcw-sv-head { display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid var(--border); flex-shrink:0; }
.rcw-sv-body { flex:1; min-height:0; overflow-y:auto; padding:12px; display:flex; flex-direction:column; gap:10px; }
.rcw-sv-card { border:1px solid rgb(84 230 255 / .2); border-radius:11px; padding:12px 14px; background: rgb(84 230 255 / .04); }
.rcw-sv-card.owned { border-color: rgb(127 209 139 / .35); }
.rcw-sv-name { font-size:13px; font-weight:700; letter-spacing:.05em; color:#e6f2f4; }
.rcw-sv-host { font-size:11px; color:var(--text-soft); }
.rcw-sv-badge { font-size:9px; letter-spacing:.14em; padding:2px 8px; border-radius:999px; border:1px solid rgb(84 230 255 / .4); color: rgb(84 230 255 / .9); }
.rcw-sv-badge.green { border-color: rgb(127 209 139 / .5); color:#7fd18b; }
.rcw-sv-badge.warn { border-color: rgb(224 162 74 / .5); color:#e0a24a; }
.rcw-sv-label { display:block; font-size:9px; letter-spacing:.26em; color: rgb(84 230 255 / .7); margin:8px 0 4px 2px; }
.rcw-sv-input { width:100%; box-sizing:border-box; padding:8px 10px; border-radius:7px; font-size:12px; font-family:inherit;
  border:1px solid rgb(84 230 255 / .28); background: rgb(84 230 255 / .05); color:#e6f2f4; outline:none; }
.rcw-sv-btn { padding:7px 13px; border-radius:8px; border:1px solid rgb(84 230 255 / .55); cursor:pointer; font-family:inherit;
  background: rgb(84 230 255 / .13); color:#d9f7ff; font-size:10.5px; font-weight:700; letter-spacing:.16em; }
.rcw-sv-btn:hover:not(:disabled) { background: rgb(84 230 255 / .22); }
.rcw-sv-btn:disabled { opacity:.45; cursor:not-allowed; }
.rcw-sv-btn.warn { border-color: rgb(224 115 106 / .55); background: rgb(224 115 106 / .1); color:#ff9d94; }
.rcw-sv-chip { display:inline-flex; align-items:center; gap:4px; font-size:9.5px; padding:2px 7px; border-radius:999px; border:1px solid var(--border); color:var(--text-soft); margin:2px 3px 0 0; }
`;

const EMPTY = { name: "", host: "", sshUser: "root", sshPort: 22, description: "" };

export default function ServersPanel() {
  const [me, setMe] = useState<{ role: string } | null>(null);
  const [servers, setServers] = useState<ServerView[]>([]);
  const [coworkKey, setCoworkKey] = useState<string | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const isAdmin = me?.role === "admin";

  const reload = useCallback(async () => {
    try {
      const [meR, list, key] = await Promise.all([
        window.cowork.accountsMe(),
        window.cowork.serversList(),
        window.cowork.serverCoworkKey().catch(() => ({ publicKey: null })),
      ]);
      setMe(meR as { role: string });
      setServers(list);
      setCoworkKey(key.publicKey);
      setErr("");
    } catch (e) {
      setErr(`Registry unavailable (${e instanceof Error ? e.message : e})`);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2400); };
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: k === "sshPort" ? Number(e.target.value) || 22 : e.target.value }));

  async function create() {
    setBusy(true); setErr("");
    try {
      await window.cowork.serverCreate({ ...form, name: form.name.trim(), host: form.host.trim() });
      setForm(EMPTY); setAdding(false); await reload();
      flash("SERVER ADDED");
    } catch (e) { setErr(`Add failed (${e instanceof Error ? e.message : e})`); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    setBusy(true);
    try { await window.cowork.serverDelete(id); await reload(); flash("SERVER REMOVED"); }
    finally { setBusy(false); }
  }

  return (
    <div className="rcw-sv">
      <style>{CSS}</style>
      <div className="rcw-sv-head">
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".3em", color: "rgb(84 230 255 / .9)" }}>SERVER REGISTRY</span>
        <span className="faint" style={{ fontSize: 9.5, letterSpacing: ".2em" }}>YOUR CONNECTED MACHINES</span>
        <span style={{ flex: 1 }} />
        {msg && <span style={{ fontSize: 10, color: "#7fd18b", letterSpacing: ".14em" }}>{msg}</span>}
        <button className="rcw-sv-btn" onClick={() => setAdding((a) => !a)}>{adding ? "CANCEL" : "＋ ADD SERVER"}</button>
      </div>

      {err && <div style={{ padding: "10px 14px", color: "#ff7d72", fontSize: 11.5 }}>⚠ {err}</div>}

      <div className="rcw-sv-body no-scrollbar">
        {adding && (
          <div className="rcw-sv-card">
            <label className="rcw-sv-label">NAME</label>
            <input className="rcw-sv-input" value={form.name} onChange={set("name")} placeholder="VPS Alpha" />
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 2 }}><label className="rcw-sv-label">HOST / IP</label><input className="rcw-sv-input" value={form.host} onChange={set("host")} placeholder="10.0.0.1" autoCapitalize="off" spellCheck={false} /></div>
              <div style={{ flex: 1 }}><label className="rcw-sv-label">SSH USER</label><input className="rcw-sv-input" value={form.sshUser} onChange={set("sshUser")} /></div>
              <div style={{ width: 70 }}><label className="rcw-sv-label">PORT</label><input className="rcw-sv-input" value={form.sshPort} onChange={set("sshPort")} /></div>
            </div>
            <label className="rcw-sv-label">DESCRIPTION</label>
            <input className="rcw-sv-input" value={form.description} onChange={set("description")} placeholder="optional" />
            {coworkKey && (
              <div style={{ marginTop: 10, padding: 9, borderRadius: 7, background: "rgb(84 230 255 / .06)", border: "1px solid rgb(84 230 255 / .2)" }}>
                <div style={{ fontSize: 9.5, letterSpacing: ".14em", color: "rgb(84 230 255 / .8)", marginBottom: 4 }}>INSTALL THIS KEY ON THE VPS (authorized_keys):</div>
                <code style={{ fontSize: 9.5, wordBreak: "break-all", color: "var(--text-soft)" }}>{coworkKey}</code>
                <button className="rcw-sv-btn" style={{ marginTop: 6 }} onClick={() => navigator.clipboard.writeText(coworkKey)}>COPY KEY</button>
              </div>
            )}
            <button className="rcw-sv-btn" style={{ marginTop: 12 }} disabled={busy || !form.name.trim() || !form.host.trim()} onClick={create}>{busy ? "…" : "SAVE"}</button>
          </div>
        )}

        {servers.map((s) => {
          const owned = !!s.ownerAccountId;
          return (
            <div key={s.id} className={`rcw-sv-card ${owned ? "owned" : ""}`}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <span className="rcw-sv-name">{s.name}</span>
                  <span className="rcw-sv-host">  {s.sshUser}@{s.host}:{s.sshPort}</span>
                  {s.description && <div className="rcw-sv-host" style={{ marginTop: 2 }}>{s.description}</div>}
                </div>
                {owned ? <span className="rcw-sv-badge green">MINE</span> : <span className="rcw-sv-badge">COMPANY</span>}
                {s.keyInstalled ? <span className="rcw-sv-badge green">KEY OK</span> : <span className="rcw-sv-badge warn">KEY?</span>}
              </div>

              {(isAdmin || owned) && (
                <div style={{ marginTop: 8 }}>
                  <button className="rcw-sv-btn warn" disabled={busy} onClick={() => remove(s.id)}>REMOVE</button>
                </div>
              )}
            </div>
          );
        })}
        {!servers.length && !adding && !err && <span className="faint" style={{ fontSize: 11.5 }}>No servers yet. Add one, or open a session to auto-discover your connected hosts.</span>}
      </div>
    </div>
  );
}
