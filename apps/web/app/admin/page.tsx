"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// YITEC web admin console: agent roster (create + edit full profile incl. photo,
// rank, division, contacts, webhook, Jira project) and the token-usage analytics
// console. Talks to the API through the cookie-authed /api/proxy.

type Account = {
  id: string; username: string; displayName: string; role: "admin" | "member";
  photo: string | null; level: string; division: string; email: string;
  jira: string; mattermost: string; phone: string; webhook: string; jiraProject: string;
  disabledAt: string | null;
};
type Analytics = { accountId: string; username: string; displayName: string; sessions: number; activeSessions: number; tokensInput: number; tokensOutput: number; estCostUsd: number; lastActiveAt: string | null };

const api = (p: string, init?: RequestInit) => fetch(`/api/proxy/${p}`, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
const fmtK = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(0) + "k" : String(n));
const EMPTY = { username: "", password: "", displayName: "", level: "", division: "", email: "", jira: "", mattermost: "", phone: "", webhook: "", jiraProject: "", photo: null as string | null };

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, 512 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
    img.src = url;
  });
}

export default function Admin() {
  const [me, setMe] = useState<{ role: string; username: string | null } | null>(null);
  const [tab, setTab] = useState<"roster" | "console">("roster");
  const [agents, setAgents] = useState<Account[]>([]);
  const [analytics, setAnalytics] = useState<Analytics[]>([]);
  const [sel, setSel] = useState<Account | null>(null);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [recruit, setRecruit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const isAdmin = me?.role === "admin";

  const reload = useCallback(async () => {
    try {
      const meR = await api("accounts/me");
      if (meR.status === 401) { window.location.href = "/login"; return; }
      setMe(await meR.json());
      const list = await api("accounts");
      if (list.ok) setAgents(await list.json());
      else setErr("Admin access required.");
    } catch { setErr("Could not reach the server."); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => { if (tab === "console") api("accounts/analytics").then(async (r) => { if (r.ok) setAnalytics(await r.json()); }).catch(() => {}); }, [tab]);
  useEffect(() => { if (sel) setForm({ ...EMPTY, ...sel, password: "" }); }, [sel]);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2400); };
  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f) return;
    try { const photo = await fileToDataUrl(f); setForm((p) => ({ ...p, photo })); flash("photo loaded — save to apply"); }
    catch { setErr("Could not read that image."); }
  }

  async function saveProfile() {
    if (!sel) return; setBusy(true); setErr("");
    try {
      const { username: _u, password: _p, ...patch } = form;
      const r = await api(`accounts/${sel.id}/profile`, { method: "POST", body: JSON.stringify(patch) });
      if (!r.ok) throw new Error(String(r.status));
      await reload(); const updated = await r.json(); setSel(updated); flash("DOSSIER SAVED");
    } catch (e) { setErr(`Save failed (${e instanceof Error ? e.message : e})`); }
    finally { setBusy(false); }
  }
  async function create() {
    setBusy(true); setErr("");
    try {
      const r = await api("accounts", { method: "POST", body: JSON.stringify({ ...form, displayName: form.displayName || form.username }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || j.error || r.status); }
      await reload(); setRecruit(false); setForm(EMPTY); flash("AGENT RECRUITED");
    } catch (e) { setErr(`Recruit failed (${e instanceof Error ? e.message : e})`); }
    finally { setBusy(false); }
  }
  async function toggleDisabled() {
    if (!sel) return; setBusy(true);
    try { await api(`accounts/${sel.id}/${sel.disabledAt ? "enable" : "disable"}`, { method: "POST" }); await reload(); flash(sel.disabledAt ? "REACTIVATED" : "SUSPENDED"); setSel(null); }
    finally { setBusy(false); }
  }

  const field = (label: string, k: keyof typeof EMPTY, ph = "", type = "text") => (
    <label className="f"><span>{label}</span><input value={(form[k] as string) ?? ""} onChange={set(k)} placeholder={ph} type={type} autoCapitalize="off" spellCheck={false} /></label>
  );

  return (
    <main className="ad">
      <style>{CSS}</style>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      <header className="ad-head">
        <span className="ad-logo">◈ YITEC</span><span className="ad-sub">INTELLIGENCE AGENCY · COMMAND CONSOLE</span>
        <div className="ad-tabs">
          <button className={tab === "roster" ? "on" : ""} onClick={() => setTab("roster")}>AGENT ROSTER</button>
          {isAdmin && <button className={tab === "console" ? "on" : ""} onClick={() => setTab("console")}>TOKEN CONSOLE</button>}
        </div>
        <span style={{ flex: 1 }} />
        {msg && <span className="ad-ok">{msg}</span>}
        <span className="ad-me">{me?.username ? `@${me.username}` : "operator"}</span>
        <a className="ad-out" href="/api/logout">SIGN OUT</a>
      </header>

      {err && <div className="ad-err">⚠ {err}</div>}

      {tab === "console" ? (
        <section className="ad-body">
          <div className="ad-panel" style={{ maxWidth: 960 }}>
            <h2>TOKEN SPEND &amp; ACTIVITY · PER AGENT</h2>
            <table className="ad-table"><thead><tr><th>AGENT</th><th>SESSIONS</th><th>TOKENS IN</th><th>TOKENS OUT</th><th>EST. COST</th><th>LAST ACTIVE</th></tr></thead>
              <tbody>
                {analytics.map((r) => (
                  <tr key={r.accountId}>
                    <td><b>{r.displayName}</b> <span className="dim">@{r.username}</span></td>
                    <td>{r.sessions}{r.activeSessions > 0 && <span className="live"> ({r.activeSessions} live)</span>}</td>
                    <td>{fmtK(r.tokensInput)}</td><td>{fmtK(r.tokensOutput)}</td>
                    <td className="cost">${r.estCostUsd.toFixed(2)}</td>
                    <td className="dim">{r.lastActiveAt ? new Date(r.lastActiveAt).toLocaleString() : "—"}</td>
                  </tr>
                ))}
                {!analytics.length && <tr><td colSpan={6} className="dim">No activity yet.</td></tr>}
              </tbody>
            </table>
            {analytics.length > 0 && <p className="ad-total">Total est. spend: <b>${analytics.reduce((s, r) => s + r.estCostUsd, 0).toFixed(2)}</b> across {analytics.reduce((s, r) => s + r.sessions, 0)} sessions</p>}
          </div>
        </section>
      ) : (
        <section className="ad-body two">
          <div className="ad-panel">
            <div className="ad-panel-head"><h2>AGENTS ({agents.length})</h2>{isAdmin && <button className="ad-btn sm" onClick={() => { setRecruit(true); setSel(null); setForm(EMPTY); }}>＋ RECRUIT</button>}</div>
            <div className="ad-grid">
              {agents.map((a) => (
                <button key={a.id} className={`ad-card ${sel?.id === a.id ? "sel" : ""} ${a.disabledAt ? "dis" : ""}`} onClick={() => { setSel(a); setRecruit(false); }}>
                  {a.photo ? <img src={a.photo} alt="" /> : <span className="ph">◍</span>}
                  <b>{a.displayName || a.username}</b>
                  <span className="dim">@{a.username}</span>
                  <div className="badges">
                    {a.role === "admin" && <span className="b gold">DIRECTOR</span>}
                    {a.level && <span className="b">{a.level.toUpperCase()}</span>}
                    {a.division && <span className="b dim">{a.division.toUpperCase()}</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {(sel || recruit) && (
            <div className="ad-panel dossier">
              {recruit ? <h2>NEW AGENT DOSSIER</h2> : <h2>{sel?.displayName || sel?.username}</h2>}
              <div className="photo-row">
                {(recruit ? form.photo : sel?.photo) ? <img className="big" src={(recruit ? form.photo : sel?.photo)!} alt="" onClick={() => isAdmin && fileRef.current?.click()} /> : <span className="big ph" onClick={() => isAdmin && fileRef.current?.click()}>◍</span>}
                {isAdmin && <button className="ad-btn sm" onClick={() => fileRef.current?.click()}>UPLOAD PHOTO</button>}
              </div>
              {recruit && field("AGENT ID (USERNAME)", "username", "firstname.lastname")}
              {recruit && field("ACCESS CODE", "password", "min 8 chars", "password")}
              {field("AGENT NAME", "displayName")}
              {field("LEVEL / RANK", "level", "e.g. L4")}
              {field("DIVISION", "division", "e.g. Cyber Ops")}
              {field("EMAIL", "email")}
              {field("JIRA USERNAME", "jira")}
              {field("JIRA PROJECT KEY", "jiraProject", "e.g. RCW")}
              {field("MATTERMOST", "mattermost")}
              {field("PHONE", "phone")}
              {field("WEBHOOK URL", "webhook", "Jira mission notifications")}
              <div className="row">
                {recruit ? (
                  <>
                    <button className="ad-btn" disabled={busy || form.username.trim().length < 2 || form.password.length < 8} onClick={create}>{busy ? "…" : "COMMISSION"}</button>
                    <button className="ad-btn ghost" onClick={() => setRecruit(false)}>CANCEL</button>
                  </>
                ) : (
                  <>
                    <button className="ad-btn" disabled={busy} onClick={saveProfile}>{busy ? "…" : "SAVE DOSSIER"}</button>
                    {isAdmin && <button className="ad-btn warn" disabled={busy} onClick={toggleDisabled}>{sel?.disabledAt ? "REACTIVATE" : "SUSPEND"}</button>}
                  </>
                )}
              </div>
            </div>
          )}
        </section>
      )}
    </main>
  );
}

const CSS = `
.ad { min-height:100vh; background: radial-gradient(ellipse 120% 80% at 50% 0%, #0a1620, #050a10 60%, #030608); color:#e6f2f4; font-family:"SF Mono",ui-monospace,monospace; }
.ad-head { display:flex; align-items:center; gap:14px; padding:14px 22px; border-bottom:1px solid rgb(84 230 255 / .18); }
.ad-logo { font-weight:700; letter-spacing:.2em; color:#54e6ff; }
.ad-sub { font-size:9.5px; letter-spacing:.2em; color: rgb(230 242 244 / .4); }
.ad-tabs { display:flex; gap:4px; margin-left:18px; }
.ad-tabs button { background:none; border:1px solid transparent; color: rgb(230 242 244 / .5); font-family:inherit; font-size:11px; letter-spacing:.16em; padding:6px 12px; border-radius:8px; cursor:pointer; }
.ad-tabs button.on { color:#d9f7ff; border-color: rgb(84 230 255 / .5); background: rgb(84 230 255 / .1); }
.ad-me { font-size:11px; color: rgb(230 242 244 / .55); }
.ad-ok { font-size:10.5px; color:#7fd18b; letter-spacing:.12em; }
.ad-out { font-size:10px; letter-spacing:.14em; color:#ff9d94; text-decoration:none; border:1px solid rgb(224 115 106 / .4); padding:5px 11px; border-radius:8px; }
.ad-err { margin:14px 22px 0; color:#ff7d72; font-size:12px; }
.ad-body { padding:22px; }
.ad-body.two { display:grid; grid-template-columns: 1fr 380px; gap:16px; align-items:start; }
.ad-panel { border:1px solid rgb(84 230 255 / .18); border-radius:14px; background: rgb(8 14 20 / .55); padding:16px 18px; }
.ad-panel h2 { font-size:12px; letter-spacing:.2em; color: rgb(84 230 255 / .85); margin:0 0 12px; }
.ad-panel-head { display:flex; align-items:center; justify-content:space-between; }
.ad-grid { display:grid; grid-template-columns: repeat(auto-fill, minmax(150px,1fr)); gap:10px; }
.ad-card { display:flex; flex-direction:column; align-items:center; gap:5px; padding:14px 10px; border-radius:12px; cursor:pointer;
  border:1px solid rgb(84 230 255 / .2); background: rgb(84 230 255 / .04); color:#e6f2f4; font-family:inherit; }
.ad-card:hover { border-color: rgb(84 230 255 / .5); }
.ad-card.sel { border-color: rgb(84 230 255 / .8); box-shadow: 0 0 20px -6px rgb(84 230 255 / .6); }
.ad-card.dis { opacity:.45; }
.ad-card img, .ad-card .ph { width:56px; height:56px; border-radius:50%; object-fit:cover; border:2px solid rgb(84 230 255 / .5); box-shadow:0 0 14px -4px rgb(84 230 255 / .6); background:#05090d; display:flex; align-items:center; justify-content:center; font-size:22px; color: rgb(84 230 255 / .5); }
.ad-card b { font-size:12.5px; }
.badges { display:flex; flex-wrap:wrap; gap:4px; justify-content:center; }
.b { font-size:8.5px; letter-spacing:.12em; padding:2px 7px; border-radius:999px; border:1px solid rgb(84 230 255 / .4); color: rgb(84 230 255 / .9); }
.b.gold { border-color: rgb(224 162 74 / .55); color:#e0a24a; } .b.dim { border-color: rgb(255 255 255 / .15); color: rgb(230 242 244 / .5); }
.dim { color: rgb(230 242 244 / .45); } .live { color:#7fd18b; }
.dossier .photo-row { display:flex; flex-direction:column; align-items:center; gap:8px; margin-bottom:10px; }
.dossier .big { width:84px; height:84px; border-radius:50%; object-fit:cover; border:2px solid rgb(84 230 255 / .55); cursor:pointer; background:#05090d; display:flex; align-items:center; justify-content:center; font-size:30px; color: rgb(84 230 255 / .5); }
.f { display:block; margin-bottom:9px; } .f span { display:block; font-size:8.5px; letter-spacing:.24em; color: rgb(84 230 255 / .7); margin:0 0 4px 2px; }
.f input { width:100%; box-sizing:border-box; padding:8px 10px; border-radius:7px; font-size:12px; font-family:inherit; border:1px solid rgb(84 230 255 / .28); background: rgb(84 230 255 / .05); color:#e6f2f4; outline:none; }
.f input:focus { border-color: rgb(84 230 255 / .7); }
.row { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
.ad-btn { padding:9px 16px; border-radius:8px; border:1px solid rgb(84 230 255 / .6); cursor:pointer; font-family:inherit; background: rgb(84 230 255 / .14); color:#d9f7ff; font-size:11px; font-weight:700; letter-spacing:.16em; }
.ad-btn:hover:not(:disabled) { background: rgb(84 230 255 / .24); } .ad-btn:disabled { opacity:.45; cursor:not-allowed; }
.ad-btn.sm { padding:6px 12px; font-size:10px; } .ad-btn.ghost { border-color: rgb(255 255 255 / .18); background:transparent; color: rgb(230 242 244 / .6); }
.ad-btn.warn { border-color: rgb(224 115 106 / .55); background: rgb(224 115 106 / .1); color:#ff9d94; }
.ad-table { width:100%; border-collapse:collapse; font-size:12px; }
.ad-table th { text-align:left; font-size:9px; letter-spacing:.14em; color: rgb(230 242 244 / .4); padding:6px 10px; }
.ad-table td { padding:8px 10px; border-top:1px solid rgb(84 230 255 / .12); }
.ad-table .cost { color:#e0a24a; font-weight:700; }
.ad-total { margin-top:14px; font-size:12.5px; color: rgb(230 242 244 / .7); } .ad-total b { color:#e0a24a; }
`;
