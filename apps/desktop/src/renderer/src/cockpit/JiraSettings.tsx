import { useEffect, useState } from "react";

type Profile = { name: string; baseUrl: string; account: string | null };
type Binding = { profile: string; projectKey: string; boardId: number | null };

const input: React.CSSProperties = {
  border: "1px solid var(--border)", background: "rgba(255,255,255,0.03)", borderRadius: 8,
  padding: "7px 10px", fontSize: 12, color: "var(--text)", outline: "none", fontFamily: "var(--font-mono)",
};

/** Notify the todo window that this session's Jira binding changed (refetch issues). */
function announce(sessionId: string) {
  window.dispatchEvent(new CustomEvent("rcw-jira-binding", { detail: { sessionId } }));
}

/**
 * Project-management (Jira) settings for a session: manage globally-shared Jira
 * profiles (instance URL + PAT, stored encrypted server-side) and bind THIS session
 * to a profile + project so its current-sprint issues flow into the Tasks tab.
 */
export default function JiraSettings({ sessionId }: { sessionId: string }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [binding, setBinding] = useState<Binding | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // New-profile form.
  const [adding, setAdding] = useState(false);
  const [pName, setPName] = useState("");
  const [pUrl, setPUrl] = useState("");
  const [pPat, setPPat] = useState("");
  const [busy, setBusy] = useState(false);

  // Bind form.
  const [selProfile, setSelProfile] = useState("");
  const [projectKey, setProjectKey] = useState("");
  const [boardId, setBoardId] = useState("");

  const loadProfiles = () => window.cowork.jiraProfilesList().then(setProfiles).catch(() => {});
  const loadBinding = () => window.cowork.jiraGetBinding(sessionId).then((b) => {
    setBinding(b);
    if (b) { setSelProfile(b.profile); setProjectKey(b.projectKey); setBoardId(b.boardId != null ? String(b.boardId) : ""); }
  }).catch(() => {});
  useEffect(() => { loadProfiles(); }, []);
  useEffect(() => { loadBinding(); /* eslint-disable-next-line */ }, [sessionId]);

  const saveProfile = async () => {
    const name = pName.trim();
    if (!name || !pUrl.trim() || !pPat.trim() || busy) return;
    setBusy(true); setStatus(null);
    try {
      const r = await window.cowork.jiraProfilePut(name, pUrl.trim(), pPat.trim());
      setStatus({ kind: "ok", text: `✓ connected${r.account ? ` as ${r.account}` : ""}` });
      setAdding(false); setPName(""); setPUrl(""); setPPat("");
      loadProfiles();
    } catch (e) {
      setStatus({ kind: "err", text: `Jira auth failed — check URL & token` });
    } finally { setBusy(false); }
  };
  const deleteProfile = async (name: string) => {
    await window.cowork.jiraProfileDelete(name).catch(() => {});
    loadProfiles();
  };

  const connect = async () => {
    if (!selProfile || !projectKey.trim() || busy) return;
    setBusy(true); setStatus(null);
    try {
      await window.cowork.jiraSetBinding(sessionId, {
        profile: selProfile, projectKey: projectKey.trim().toUpperCase(),
        boardId: boardId.trim() ? Number(boardId.trim()) : null,
      });
      setStatus({ kind: "ok", text: "✓ session connected to Jira" });
      announce(sessionId);
      loadBinding();
    } catch { setStatus({ kind: "err", text: "could not connect this session" }); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    await window.cowork.jiraClearBinding(sessionId).catch(() => {});
    setBinding(null); announce(sessionId); setStatus(null);
  };

  const boundProfile = binding && profiles.find((p) => p.name === binding.profile);

  return (
    <div style={{ padding: "10px 18px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      {/* This session's binding */}
      <div>
        <div className="mono faint" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>This session</div>
        {binding ? (
          <div className="glass-inset" style={{ padding: "10px 12px", borderRadius: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: "rgb(var(--accent))", flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 12.5, color: "var(--text)" }}>{binding.projectKey} · {binding.profile}</div>
              <div className="faint" style={{ fontSize: 10.5 }}>{boundProfile?.baseUrl}{boundProfile?.account ? ` · ${boundProfile.account}` : ""}</div>
            </div>
            <button onClick={disconnect} style={{ border: "1px solid var(--border)", background: "transparent", color: "#e0736a", borderRadius: 8, padding: "5px 11px", fontSize: 11, cursor: "pointer" }}>Disconnect</button>
          </div>
        ) : profiles.length === 0 ? (
          <div className="faint" style={{ fontSize: 11.5 }}>Add a Jira profile below, then connect this session to a project.</div>
        ) : (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <select value={selProfile} onChange={(e) => setSelProfile(e.target.value)} className="mono" style={{ ...input, cursor: "pointer" }}>
              <option value="">profile…</option>
              {profiles.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
            <input value={projectKey} onChange={(e) => setProjectKey(e.target.value)} placeholder="PROJECT KEY (e.g. RCW)" style={{ ...input, width: 190 }} />
            <input value={boardId} onChange={(e) => setBoardId(e.target.value.replace(/[^0-9]/g, ""))} placeholder="board# (opt)" style={{ ...input, width: 96 }} />
            <button onClick={connect} disabled={busy || !selProfile || !projectKey.trim()} className="glass-btn--clay" style={{ padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, opacity: selProfile && projectKey.trim() ? 1 : 0.5 }}>Connect</button>
          </div>
        )}
      </div>

      {/* Global Jira profiles */}
      <div>
        <div className="mono faint" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>Jira profiles (shared)</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
          {profiles.length === 0 && <span className="faint" style={{ fontSize: 11.5, fontStyle: "italic" }}>No profiles yet.</span>}
          {profiles.map((p) => (
            <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
              <span className="mono" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "0 0 auto", color: "var(--text)" }}>{p.name}</span>
              <span className="faint" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10.5 }}>{p.baseUrl}</span>
              {p.account && <span className="mono" style={{ fontSize: 9.5, padding: "1px 6px", borderRadius: 999, background: "rgb(var(--primary) / 0.16)", color: "var(--text-soft)" }}>{p.account}</span>}
              <button onClick={() => deleteProfile(p.name)} style={{ border: 0, background: "transparent", color: "#e0736a", cursor: "pointer", fontSize: 11 }}>delete</button>
            </div>
          ))}
        </div>
        {adding ? (
          <div className="glass-inset" style={{ padding: 11, borderRadius: 10, display: "flex", flexDirection: "column", gap: 7 }}>
            <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="profile name (e.g. examplehost)" style={input} />
            <input value={pUrl} onChange={(e) => setPUrl(e.target.value)} placeholder="https://jira.examplehost.group" style={input} />
            <input value={pPat} onChange={(e) => setPPat(e.target.value)} type="password" placeholder="Personal Access Token" style={input} />
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={saveProfile} disabled={busy || !pName.trim() || !pUrl.trim() || !pPat.trim()} className="glass-btn--clay" style={{ padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{busy ? "validating…" : "Save & validate"}</button>
              <button onClick={() => { setAdding(false); setStatus(null); }} style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => { setAdding(true); setStatus(null); }} className="glass-btn--clay" style={{ padding: "6px 13px", borderRadius: 8, fontSize: 12, fontWeight: 600 }}>+ New Jira profile</button>
        )}
      </div>

      {status && <span className="mono" style={{ fontSize: 11, color: status.kind === "ok" ? "rgb(var(--accent))" : "#e0736a" }}>{status.text}</span>}
    </div>
  );
}
