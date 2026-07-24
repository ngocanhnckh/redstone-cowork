import { useCallback, useEffect, useRef, useState } from "react";
import { describeFaceFromImageUrl } from "../faceEngine";

// ——— AGENT ROSTER — YITEC INTELLIGENCE AGENCY personnel dashboard ———
// Admin-only management of employee accounts: recruit agents, edit profiles
// (name, photo, level, division, contacts, webhook), disable/enable, and review
// the login audit trail. The photo doubles as the face-enrollment source for
// face sign-in (Slice 2) — the admin uploads it here BEFORE the agent enrolls.

type Audit = { id: string; accountId: string | null; username: string; ok: boolean; ip: string; device: string; at: string };
type JiraUser = { name: string; key?: string; displayName: string; email?: string; avatarUrl?: string };

/** Searchable Jira-user dropdown: type to search the admin's Jira (via a stored
 *  profile), pick a user to bind the agent to that Jira account. Typing also sets the
 *  raw username so a manual value still works if the search is empty/unavailable. */
function JiraUserPicker({ value, profile, onType, onPick }: {
  value: string; profile: string; onType: (v: string) => void; onPick: (u: JiraUser) => void;
}) {
  const [q, setQ] = useState(value);
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<JiraUser[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => { setQ(value); }, [value]);
  useEffect(() => {
    if (!open || !profile) return;
    let alive = true;
    const t = setTimeout(() => {
      setLoading(true);
      window.cowork.jiraProfileUsers(profile, q).then((r) => { if (alive) setResults(r); })
        .catch(() => { if (alive) setResults([]); }).finally(() => { if (alive) setLoading(false); });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open, profile]);
  return (
    <div style={{ position: "relative" }}>
      <input className="rcw-ag-input" value={q} placeholder="search Jira users…" autoCapitalize="off" autoCorrect="off" spellCheck={false}
        onChange={(e) => { setQ(e.target.value); onType(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 180)} />
      {open && (results.length > 0 || loading) && (
        <div className="no-scrollbar" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 40, marginTop: 3, maxHeight: 220, overflowY: "auto",
          border: "1px solid rgb(84 230 255 / .4)", borderRadius: 9, background: "rgb(8 14 20 / .97)", backdropFilter: "blur(10px)", boxShadow: "0 12px 40px -10px rgb(0 0 0 / .7)" }}>
          {loading && <div className="faint" style={{ padding: "8px 10px", fontSize: 10.5 }}>searching…</div>}
          {results.map((u) => (
            <div key={(u.key || u.name) + u.displayName} onMouseDown={(e) => { e.preventDefault(); onPick(u); setQ(u.name); setOpen(false); }}
              style={{ display: "flex", alignItems: "center", gap: 9, padding: "7px 10px", cursor: "pointer", borderBottom: "1px solid rgb(84 230 255 / .1)" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "rgb(84 230 255 / .12)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
              {u.avatarUrl ? <img src={u.avatarUrl} alt="" style={{ width: 24, height: 24, borderRadius: 6, objectFit: "cover" }} />
                : <div style={{ width: 24, height: 24, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", background: "rgb(84 230 255 / .12)", fontSize: 11 }}>◍</div>}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12, color: "#e6f2f4", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.displayName}</div>
                <div className="faint" style={{ fontSize: 10 }}>@{u.name}{u.email ? ` · ${u.email}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const CSS = `
@keyframes rcw-ag-in { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform:none; } }
.rcw-ag { height:100%; min-height:0; display:flex; flex-direction:column; font-family:var(--font-mono); }
.rcw-ag-head { display:flex; align-items:center; gap:10px; padding:10px 14px; border-bottom:1px solid var(--border); flex-shrink:0; }
.rcw-ag-grid { flex:1; min-height:0; overflow-y:auto; padding:12px; display:grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap:10px; align-content:start; }
.rcw-ag-card { position:relative; border:1px solid rgb(84 230 255 / .22); border-radius:12px; padding:14px 12px 11px; cursor:pointer;
  background: rgb(84 230 255 / .04); animation: rcw-ag-in .22s ease both; transition: border-color .15s, box-shadow .15s; }
.rcw-ag-card:hover { border-color: rgb(84 230 255 / .55); box-shadow: 0 0 24px -8px rgb(84 230 255 / .6); }
.rcw-ag-card.sel { border-color: rgb(84 230 255 / .8); box-shadow: 0 0 26px -6px rgb(84 230 255 / .7); }
.rcw-ag-card.dis { opacity:.45; }
.rcw-ag-photo { width:64px; height:64px; border-radius:50%; object-fit:cover; display:block; margin:0 auto 8px;
  border:2px solid rgb(84 230 255 / .5); box-shadow: 0 0 16px -4px rgb(84 230 255 / .6); background:#05090d; }
.rcw-ag-photo.ph { display:flex; align-items:center; justify-content:center; font-size:24px; color: rgb(84 230 255 / .5); }
.rcw-ag-name { text-align:center; font-size:12.5px; font-weight:700; letter-spacing:.06em; color:#e6f2f4; }
.rcw-ag-user { text-align:center; font-size:10px; color:var(--text-faint); margin-top:2px; }
.rcw-ag-badges { display:flex; justify-content:center; gap:5px; margin-top:7px; flex-wrap:wrap; }
.rcw-ag-badge { font-size:9px; letter-spacing:.14em; padding:2px 8px; border-radius:999px; border:1px solid rgb(84 230 255 / .4); color: rgb(84 230 255 / .9); }
.rcw-ag-badge.gold { border-color: rgb(224 162 74 / .55); color:#e0a24a; }
.rcw-ag-badge.dim { border-color: var(--border); color: var(--text-soft); }
.rcw-ag-side { width:340px; flex-shrink:0; border-left:1px solid var(--border); overflow-y:auto; padding:14px; }
.rcw-ag-label { display:block; font-size:9px; letter-spacing:.26em; color: rgb(84 230 255 / .7); margin:10px 0 4px 2px; }
.rcw-ag-input { width:100%; box-sizing:border-box; padding:8px 10px; border-radius:7px; font-size:12px; font-family:inherit;
  border:1px solid rgb(84 230 255 / .28); background: rgb(84 230 255 / .05); color:#e6f2f4; outline:none; }
.rcw-ag-input:focus { border-color: rgb(84 230 255 / .7); }
.rcw-ag-btn { padding:8px 14px; border-radius:8px; border:1px solid rgb(84 230 255 / .6); cursor:pointer; font-family:inherit;
  background: rgb(84 230 255 / .14); color:#d9f7ff; font-size:11px; font-weight:700; letter-spacing:.18em; }
.rcw-ag-btn:hover:not(:disabled) { background: rgb(84 230 255 / .24); }
.rcw-ag-btn:disabled { opacity:.45; cursor:not-allowed; }
.rcw-ag-btn.warn { border-color: rgb(224 115 106 / .6); background: rgb(224 115 106 / .12); color:#ff9d94; }
.rcw-ag-audit { font-size:10px; line-height:1.7; }
.rcw-ag-audit td { padding:2px 8px 2px 0; white-space:nowrap; }
`;

function Photo({ a, size = 64 }: { a: { photo: string | null; displayName: string }; size?: number }) {
  return a.photo ? (
    <img className="rcw-ag-photo" style={{ width: size, height: size }} src={a.photo} alt={a.displayName} />
  ) : (
    <div className="rcw-ag-photo ph" style={{ width: size, height: size }}>◍</div>
  );
}

/** Read + downscale an image file to a ≤512px JPEG data URL (kept small for the DB). */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 512;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("unreadable image")); };
    img.src = url;
  });
}

const EMPTY = { username: "", password: "", displayName: "", level: "", division: "", email: "", jira: "", mattermost: "", phone: "", photo: null as string | null };

type Analytics = { accountId: string; username: string; displayName: string; sessions: number; activeSessions: number; tokensInput: number; tokensOutput: number; estCostUsd: number; lastActiveAt: string | null };
const fmtK = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : String(n);

export default function AgentsPanel() {
  const [me, setMe] = useState<{ role: string } | null>(null);
  const [agents, setAgents] = useState<AgentAccount[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [mode, setMode] = useState<"view" | "recruit">("view");
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [view, setView] = useState<"roster" | "console" | "servers">("roster");
  const [analytics, setAnalytics] = useState<Analytics[]>([]);
  const [svServers, setSvServers] = useState<import("../../../shared/servers").ServerView[]>([]);
  const [svGrantFor, setSvGrantFor] = useState<string | null>(null);
  const [jiraProfile, setJiraProfile] = useState<string>(""); // first Jira profile → user search
  const fileRef = useRef<HTMLInputElement>(null);

  const sel = agents.find((a) => a.id === selId) ?? null;

  const reload = useCallback(async () => {
    try {
      const [meR, list] = await Promise.all([window.cowork.accountsMe(), window.cowork.accountsList()]);
      setMe(meR as { role: string });
      setAgents(list);
      setErr("");
    } catch (e) {
      setErr(/403/.test(String(e)) ? "CLEARANCE INSUFFICIENT — admin access required." : `Roster unavailable (${e instanceof Error ? e.message : e})`);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);
  // Pick a Jira profile to search users against (admin's shared Jira credentials).
  useEffect(() => { window.cowork.jiraProfilesList().then((ps) => { if (ps[0]) setJiraProfile(ps[0].name); }).catch(() => {}); }, []);
  useEffect(() => {
    if (view === "console" && me?.role === "admin") window.cowork.accountsAnalytics().then((a) => setAnalytics(a as Analytics[])).catch(() => setAnalytics([]));
  }, [view, me]);
  const loadServers = useCallback(() => {
    window.cowork.serversList().then(setSvServers).catch(() => setSvServers([]));
  }, []);
  useEffect(() => { if (view === "servers" && me?.role === "admin") loadServers(); }, [view, me, loadServers]);

  async function svGrant(serverId: string, username: string) {
    setBusy(true);
    try { await window.cowork.serverGrant(serverId, username); setSvGrantFor(null); loadServers(); flash("ACCESS GRANTED"); }
    catch (e) { setErr(`Grant failed (${e instanceof Error ? e.message : e})`); }
    finally { setBusy(false); }
  }
  async function svRevoke(serverId: string, username: string) {
    const acct = agents.find((a) => a.username === username);
    if (!acct) return;
    setBusy(true);
    try { await window.cowork.serverRevoke(serverId, acct.id); loadServers(); flash("ACCESS REVOKED"); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    window.cowork.accountsAudit(selId ?? undefined, 40).then(setAudit).catch(() => setAudit([]));
  }, [selId, agents]);

  // Load the selected agent into the editor form.
  useEffect(() => {
    if (sel) setForm({ ...EMPTY, ...sel, password: "" });
  }, [selId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function pickPhoto() {
    fileRef.current?.click();
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const dataUrl = await fileToDataUrl(f);
      setForm((prev) => ({ ...prev, photo: dataUrl }));
      // In edit mode, push immediately so the roster card updates live.
      if (mode === "view" && sel) {
        await window.cowork.accountUpdateProfile(sel.id, { photo: dataUrl });
        await reload();
        flash("PHOTO UPDATED");
      }
    } catch {
      setErr("Could not read that image.");
    }
  }

  function flash(m: string) { setMsg(m); setTimeout(() => setMsg(""), 2200); }

  async function saveProfile() {
    if (!sel) return;
    setBusy(true);
    try {
      const { username: _u, password: _p, ...patch } = form;
      await window.cowork.accountUpdateProfile(sel.id, patch);
      await reload();
      flash("PROFILE SAVED");
    } catch (e) {
      setErr(`Save failed (${e instanceof Error ? e.message : e})`);
    } finally { setBusy(false); }
  }

  async function recruit() {
    setBusy(true);
    setErr("");
    try {
      const created = await window.cowork.accountCreate({
        username: form.username.trim(), password: form.password,
        displayName: form.displayName || form.username, photo: form.photo,
        level: form.level, division: form.division, email: form.email,
        jira: form.jira, mattermost: form.mattermost, phone: form.phone,
      });
      await reload();
      setSelId(created.id);
      setMode("view");
      flash("AGENT RECRUITED");
    } catch (e) {
      setErr(`Recruit failed (${e instanceof Error ? e.message : e})`);
    } finally { setBusy(false); }
  }

  async function enrollFaceFromPhoto() {
    if (!sel?.photo) { setErr("This agent has no photo to enroll."); return; }
    setBusy(true);
    setErr("");
    try {
      flash("COMPUTING FACE SIGNATURE…");
      const descriptor = await describeFaceFromImageUrl(sel.photo);
      if (!descriptor) { setErr("No face found in the photo — upload a clear frontal portrait."); return; }
      const r = await window.cowork.faceAdminEnroll(sel.id, descriptor);
      flash(r.ok ? "FACE ENROLLED — agent can face-unlock once device-paired" : "Enroll failed");
    } catch (e) {
      setErr(`Face enroll failed (${e instanceof Error ? e.message : e})`);
    } finally { setBusy(false); }
  }

  async function toggleDisabled() {
    if (!sel) return;
    setBusy(true);
    try {
      await window.cowork.accountSetDisabled(sel.id, !sel.disabledAt);
      await reload();
      flash(sel.disabledAt ? "AGENT REACTIVATED" : "AGENT SUSPENDED");
    } finally { setBusy(false); }
  }

  const isAdmin = me?.role === "admin";

  const field = (label: string, k: keyof typeof EMPTY, ph = "", type = "text") => (
    <>
      <label className="rcw-ag-label">{label}</label>
      <input className="rcw-ag-input" type={type} value={(form[k] as string) ?? ""} onChange={set(k)} placeholder={ph}
        autoCapitalize="off" autoCorrect="off" spellCheck={false} />
    </>
  );

  // Jira account binding: a searchable picker when a Jira profile is configured (falls
  // back to a plain username input otherwise). Selecting a user also fills the agent's
  // name / email / photo when those are still empty — one click imports from Jira.
  const jiraUserField = () => (
    <>
      <label className="rcw-ag-label">JIRA ACCOUNT</label>
      {jiraProfile ? (
        <JiraUserPicker value={form.jira} profile={jiraProfile}
          onType={(v) => setForm((f) => ({ ...f, jira: v }))}
          onPick={(u) => setForm((f) => ({
            ...f,
            jira: u.name,
            displayName: f.displayName || u.displayName,
            email: f.email || u.email || "",
            photo: f.photo || u.avatarUrl || null,
          }))} />
      ) : (
        <input className="rcw-ag-input" value={form.jira} onChange={set("jira")} placeholder="jira username"
          autoCapitalize="off" autoCorrect="off" spellCheck={false} />
      )}
    </>
  );

  return (
    <div className="rcw-ag">
      <style>{CSS}</style>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFile} />

      <div className="rcw-ag-head">
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".3em", color: "rgb(84 230 255 / .9)" }}>ADMIN CONSOLE</span>
        <span className="faint" style={{ fontSize: 9.5, letterSpacing: ".2em" }}>YITEC INTELLIGENCE AGENCY</span>
        <span style={{ flex: 1 }} />
        {msg && <span style={{ fontSize: 10, color: "#7fd18b", letterSpacing: ".14em" }}>{msg}</span>}
        {isAdmin && (
          <div style={{ display: "flex", gap: 4 }}>
            {(["roster", "console", "servers"] as const).map((v) => (
              <button key={v} className="rcw-ag-btn" style={{ opacity: view === v ? 1 : 0.55, background: view === v ? "rgb(84 230 255 / .24)" : undefined }}
                onClick={() => setView(v)}>{v === "roster" ? "ROSTER" : v === "console" ? "📊 CONSOLE" : "⬡ ACCESS"}</button>
            ))}
          </div>
        )}
        {isAdmin && view === "roster" && (
          <button className="rcw-ag-btn" onClick={() => { setMode("recruit"); setSelId(null); setForm(EMPTY); }}>
            ＋ RECRUIT AGENT
          </button>
        )}
      </div>

      {err && <div style={{ padding: "10px 14px", color: "#ff7d72", fontSize: 11.5 }}>⚠ {err}</div>}

      {view === "console" && isAdmin ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: ".2em", color: "rgb(84 230 255 / .8)", marginBottom: 10 }}>TOKEN SPEND & ACTIVITY · PER AGENT</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
            <thead><tr style={{ color: "var(--text-faint)", textAlign: "left", fontSize: 9.5, letterSpacing: ".14em" }}>
              <th style={{ padding: "4px 8px" }}>AGENT</th><th>SESSIONS</th><th>TOKENS IN</th><th>TOKENS OUT</th><th>EST. COST</th><th>LAST ACTIVE</th>
            </tr></thead>
            <tbody>
              {analytics.map((r) => (
                <tr key={r.accountId} style={{ borderTop: "1px solid var(--border)" }}>
                  <td style={{ padding: "7px 8px" }}><b style={{ color: "#e6f2f4" }}>{r.displayName}</b> <span className="faint">@{r.username}</span></td>
                  <td>{r.sessions}{r.activeSessions > 0 && <span style={{ color: "#7fd18b" }}> ({r.activeSessions} live)</span>}</td>
                  <td>{fmtK(r.tokensInput)}</td>
                  <td>{fmtK(r.tokensOutput)}</td>
                  <td style={{ color: "#e0a24a", fontWeight: 700 }}>${r.estCostUsd.toFixed(2)}</td>
                  <td className="faint">{r.lastActiveAt ? new Date(r.lastActiveAt).toLocaleString() : "—"}</td>
                </tr>
              ))}
              {!analytics.length && <tr><td colSpan={6} className="faint" style={{ padding: 12 }}>No activity recorded yet.</td></tr>}
            </tbody>
          </table>
          {analytics.length > 0 && (
            <div style={{ marginTop: 14, fontSize: 12, color: "var(--text-soft)" }}>
              Total est. spend: <b style={{ color: "#e0a24a" }}>${analytics.reduce((s, r) => s + r.estCostUsd, 0).toFixed(2)}</b> across {analytics.reduce((s, r) => s + r.sessions, 0)} sessions
            </div>
          )}
        </div>
      ) : view === "servers" && isAdmin ? (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: ".2em", color: "rgb(84 230 255 / .8)", marginBottom: 4 }}>SERVER ACCESS · ASSIGN AGENTS TO MACHINES</div>
          <div className="faint" style={{ fontSize: 10, marginBottom: 12 }}>Each user@host is a distinct machine (redstone installs per user). Grant an agent access so it appears in their Servers app.</div>
          {svServers.map((s) => {
            const disc = (s as { discovered?: boolean }).discovered;
            return (
              <div key={s.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: "10px 12px", marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <b style={{ color: "#e6f2f4", fontSize: 12.5 }}>{s.name}</b>
                  <span className="faint" style={{ fontSize: 10.5 }}>{s.sshUser ? `${s.sshUser}@` : ""}{s.host}{s.sshPort !== 22 ? `:${s.sshPort}` : ""}</span>
                  {s.ownerAccountId ? <span className="rcw-ag-badge dim">PRIVATE</span> : disc ? <span className="rcw-ag-badge">DISCOVERED</span> : <span className="rcw-ag-badge">COMPANY</span>}
                </div>
                {!s.ownerAccountId && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, alignItems: "center" }}>
                      {(s.access ?? []).map((u) => (
                        <span key={u} className="rcw-ag-badge" style={{ borderColor: "rgb(127 209 139 / .5)", color: "#7fd18b" }}>{u}
                          <span style={{ cursor: "pointer", color: "#ff9d94", marginLeft: 4 }} onClick={() => svRevoke(s.id, u)}>✕</span>
                        </span>
                      ))}
                      {!(s.access ?? []).length && !disc && <span className="faint" style={{ fontSize: 10 }}>no agents assigned</span>}
                      {disc && <span className="faint" style={{ fontSize: 10 }}>assign an agent to adopt this host into the registry</span>}
                    </div>
                    {svGrantFor === s.id ? (
                      <select className="rcw-ag-input" style={{ marginTop: 7, maxWidth: 260 }} autoFocus defaultValue=""
                        onChange={(e) => e.target.value && svGrant(s.id, e.target.value)}>
                        <option value="" disabled>select agent…</option>
                        {agents.filter((a) => !(s.access ?? []).includes(a.username)).map((a) => (
                          <option key={a.id} value={a.username}>{a.displayName} (@{a.username})</option>
                        ))}
                      </select>
                    ) : (
                      <button className="rcw-ag-btn" style={{ marginTop: 7, padding: "5px 11px", fontSize: 10 }} disabled={busy} onClick={() => setSvGrantFor(s.id)}>＋ ASSIGN AGENT</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!svServers.length && <span className="faint" style={{ fontSize: 11.5 }}>No servers yet. Agents' connected hosts appear here once they open sessions.</span>}
        </div>
      ) : (
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <div className="rcw-ag-grid no-scrollbar">
          {agents.map((a, i) => (
            <div
              key={a.id}
              className={`rcw-ag-card ${selId === a.id ? "sel" : ""} ${a.disabledAt ? "dis" : ""}`}
              style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
              onClick={() => { setSelId(a.id); setMode("view"); }}
            >
              <Photo a={a} />
              <div className="rcw-ag-name">{a.displayName || a.username}</div>
              <div className="rcw-ag-user">@{a.username}</div>
              <div className="rcw-ag-badges">
                {a.role === "admin" && <span className="rcw-ag-badge gold">DIRECTOR</span>}
                {a.level && <span className="rcw-ag-badge">{a.level.toUpperCase()}</span>}
                {a.division && <span className="rcw-ag-badge dim">{a.division.toUpperCase()}</span>}
                {a.disabledAt && <span className="rcw-ag-badge dim">SUSPENDED</span>}
              </div>
            </div>
          ))}
          {!agents.length && !err && <span className="faint" style={{ fontSize: 11.5, padding: 8 }}>No agents on file.</span>}
        </div>

        {(sel || mode === "recruit") && (
          <div className="rcw-ag-side no-scrollbar">
            {mode === "recruit" ? (
              <>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".24em", color: "rgb(84 230 255 / .9)", marginBottom: 6 }}>NEW AGENT DOSSIER</div>
                <div style={{ display: "flex", justifyContent: "center", margin: "10px 0 2px" }}>
                  <div onClick={pickPhoto} style={{ cursor: "pointer" }} title="Upload face photo"><Photo a={{ photo: form.photo, displayName: "new" }} size={72} /></div>
                </div>
                <div style={{ textAlign: "center", fontSize: 9, letterSpacing: ".18em", color: "var(--text-faint)" }}>FACE PHOTO — CLICK TO UPLOAD</div>
                {field("AGENT ID (USERNAME)", "username", "firstname.lastname")}
                {field("ACCESS CODE (PASSWORD)", "password", "min 8 chars", "password")}
                {field("AGENT NAME", "displayName", "Full name")}
                {field("LEVEL", "level", "e.g. L3")}
                {field("DIVISION", "division", "e.g. Cyber Ops")}
                {field("EMAIL", "email", "agent@yitec.dev")}
                {jiraUserField()}
                {field("MATTERMOST HANDLE", "mattermost")}
                {field("PHONE", "phone", "+84 …")}
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button className="rcw-ag-btn" disabled={busy || form.username.trim().length < 2 || form.password.length < 8} onClick={recruit}>
                    {busy ? "…" : "COMMISSION"}
                  </button>
                  <button className="rcw-ag-btn warn" onClick={() => setMode("view")}>CANCEL</button>
                </div>
              </>
            ) : sel && (
              <>
                <div style={{ display: "flex", justifyContent: "center" }}>
                  <div onClick={isAdmin ? pickPhoto : undefined} style={{ cursor: isAdmin ? "pointer" : "default" }} title={isAdmin ? "Replace face photo" : undefined}>
                    <Photo a={sel} size={84} />
                  </div>
                </div>
                <div className="rcw-ag-name" style={{ fontSize: 14 }}>{sel.displayName || sel.username}</div>
                <div className="rcw-ag-user">@{sel.username} · {sel.role === "admin" ? "DIRECTOR" : "FIELD AGENT"}{sel.disabledAt ? " · SUSPENDED" : ""}</div>
                {isAdmin ? (
                  <>
                    {field("AGENT NAME", "displayName")}
                    {field("LEVEL", "level")}
                    {field("DIVISION", "division")}
                    {field("EMAIL", "email")}
                    {jiraUserField()}
                    {field("MATTERMOST HANDLE", "mattermost")}
                    {field("PHONE", "phone")}
                    <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                      <button className="rcw-ag-btn" disabled={busy} onClick={saveProfile}>{busy ? "…" : "SAVE DOSSIER"}</button>
                      <button className="rcw-ag-btn" disabled={busy || !sel.photo} onClick={enrollFaceFromPhoto} title="Compute a face signature from the photo so this agent can face-unlock">◈ ENROLL FACE</button>
                      <button className="rcw-ag-btn warn" disabled={busy} onClick={toggleDisabled}>
                        {sel.disabledAt ? "REACTIVATE" : "SUSPEND"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ marginTop: 10, fontSize: 11, lineHeight: 1.8, color: "var(--text-soft)" }}>
                    {sel.level && <div>LEVEL — {sel.level}</div>}
                    {sel.division && <div>DIVISION — {sel.division}</div>}
                    {sel.email && <div>✉ {sel.email}</div>}
                  </div>
                )}

                <label className="rcw-ag-label" style={{ marginTop: 18 }}>ACCESS LOG</label>
                <table className="rcw-ag-audit"><tbody>
                  {audit.slice(0, 14).map((e) => (
                    <tr key={e.id} style={{ color: e.ok ? "var(--text-soft)" : "#ff9d94" }}>
                      <td>{e.ok ? "◈" : "✕"}</td>
                      <td>{new Date(e.at).toLocaleString()}</td>
                      <td>{e.ip}</td>
                    </tr>
                  ))}
                  {!audit.length && <tr><td className="faint">no entries</td></tr>}
                </tbody></table>
              </>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
