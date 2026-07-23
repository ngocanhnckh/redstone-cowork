import { useCallback, useEffect, useRef, useState } from "react";
import { describeFaceFromImageUrl } from "../faceEngine";

// ——— AGENT ROSTER — YITEC INTELLIGENCE AGENCY personnel dashboard ———
// Admin-only management of employee accounts: recruit agents, edit profiles
// (name, photo, level, division, contacts, webhook), disable/enable, and review
// the login audit trail. The photo doubles as the face-enrollment source for
// face sign-in (Slice 2) — the admin uploads it here BEFORE the agent enrolls.

type Audit = { id: string; accountId: string | null; username: string; ok: boolean; ip: string; device: string; at: string };

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

const EMPTY = { username: "", password: "", displayName: "", level: "", division: "", email: "", jira: "", mattermost: "", phone: "", webhook: "", photo: null as string | null };

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
        jira: form.jira, mattermost: form.mattermost, phone: form.phone, webhook: form.webhook,
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

  return (
    <div className="rcw-ag">
      <style>{CSS}</style>
      <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={onFile} />

      <div className="rcw-ag-head">
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".3em", color: "rgb(84 230 255 / .9)" }}>AGENT ROSTER</span>
        <span className="faint" style={{ fontSize: 9.5, letterSpacing: ".2em" }}>YITEC INTELLIGENCE AGENCY</span>
        <span style={{ flex: 1 }} />
        {msg && <span style={{ fontSize: 10, color: "#7fd18b", letterSpacing: ".14em" }}>{msg}</span>}
        {isAdmin && (
          <button className="rcw-ag-btn" onClick={() => { setMode("recruit"); setSelId(null); setForm(EMPTY); }}>
            ＋ RECRUIT AGENT
          </button>
        )}
      </div>

      {err && <div style={{ padding: "10px 14px", color: "#ff7d72", fontSize: 11.5 }}>⚠ {err}</div>}

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
                {field("JIRA USERNAME", "jira")}
                {field("MATTERMOST HANDLE", "mattermost")}
                {field("PHONE", "phone", "+84 …")}
                {field("WEBHOOK URL", "webhook", "https://… (Jira mission notifications)")}
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
                    {field("JIRA USERNAME", "jira")}
                    {field("MATTERMOST HANDLE", "mattermost")}
                    {field("PHONE", "phone")}
                    {field("WEBHOOK URL", "webhook")}
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
    </div>
  );
}
