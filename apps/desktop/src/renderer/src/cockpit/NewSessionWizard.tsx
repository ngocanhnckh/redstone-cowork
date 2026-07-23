import { useCallback, useEffect, useMemo, useState } from "react";
import type { ServerView } from "../../../shared/servers";

// ——— NEW SESSION WIZARD ———
// Guided flow: Server → Provision (redstone) → Session (resume/new) → Folder → Mode.
// Provisioning + launch are command-based (copy-and-run on the server), which works
// for both directly-reachable and closed/NAT'd hosts (the latter via --relay reverse
// SSH). The started session reports back through the redstone hook and appears in the
// cockpit — no inbound SSH from the app required.

type Step = "server" | "provision" | "session" | "folder" | "mode" | "launch";
type Mode = "normal" | "danger";
type Discovered = { id: string; folder: string; cwd: string; title: string | null; machine: string };
type HostRow = { id: string; machine: string; address: string | null };

const CSS = `
.rcw-nw-scrim { position:fixed; inset:0; z-index:80; display:flex; align-items:center; justify-content:center; background: rgb(0 0 0 / .55);
  backdrop-filter: blur(4px); animation: yia-in .15s ease both; }
@keyframes yia-in { from { opacity:0; transform: translateY(8px);} to { opacity:1; transform:none; } }
.rcw-nw { width:560px; max-width:94vw; max-height:88vh; overflow-y:auto; border:1px solid rgb(84 230 255 / .3); border-radius:15px;
  background: color-mix(in srgb, var(--app-panel) 96%, transparent); -webkit-backdrop-filter: blur(28px) saturate(1.3); backdrop-filter: blur(28px) saturate(1.3);
  box-shadow: 0 22px 60px -16px rgb(0 0 0 / .75); font-family:var(--font-mono); }
.rcw-nw-head { display:flex; align-items:center; gap:10px; padding:14px 18px; border-bottom:1px solid var(--border); }
.rcw-nw-steps { display:flex; gap:6px; padding:10px 18px 0; }
.rcw-nw-dot { flex:1; height:3px; border-radius:2px; background: var(--border); }
.rcw-nw-dot.on { background: rgb(84 230 255 / .8); box-shadow:0 0 8px rgb(84 230 255 / .6); }
.rcw-nw-body { padding:16px 18px; }
.rcw-nw-label { display:block; font-size:9.5px; letter-spacing:.28em; color: rgb(84 230 255 / .75); margin:12px 0 5px 2px; }
.rcw-nw-input { width:100%; box-sizing:border-box; padding:9px 12px; border-radius:8px; font-size:13px; font-family:inherit;
  border:1px solid rgb(84 230 255 / .28); background: rgb(84 230 255 / .05); color:#e6f2f4; outline:none; }
.rcw-nw-opt { padding:11px 13px; border-radius:9px; border:1px solid var(--border); cursor:pointer; margin-bottom:8px; transition: border-color .12s, background .12s; }
.rcw-nw-opt:hover { border-color: rgb(84 230 255 / .5); background: rgb(84 230 255 / .05); }
.rcw-nw-opt.sel { border-color: rgb(84 230 255 / .8); background: rgb(84 230 255 / .1); }
.rcw-nw-btn { padding:9px 18px; border-radius:9px; border:1px solid rgb(84 230 255 / .6); cursor:pointer; font-family:inherit;
  background: rgb(84 230 255 / .15); color:#d9f7ff; font-size:11.5px; font-weight:700; letter-spacing:.2em; }
.rcw-nw-btn:hover:not(:disabled) { background: rgb(84 230 255 / .25); }
.rcw-nw-btn:disabled { opacity:.4; cursor:not-allowed; }
.rcw-nw-btn.ghost { border-color: var(--border); background: transparent; color: var(--text-soft); }
.rcw-nw-cmd { position:relative; margin-top:8px; padding:11px 12px; border-radius:8px; border:1px solid rgb(84 230 255 / .25);
  background: rgb(0 0 0 / .3); font-size:11px; line-height:1.5; color:#cfe9ef; word-break:break-all; }
.rcw-nw-foot { display:flex; gap:8px; justify-content:space-between; padding:14px 18px; border-top:1px solid var(--border); }
`;

const STEPS: Step[] = ["server", "provision", "session", "folder", "mode", "launch"];
const shq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

function Cmd({ cmd, label }: { cmd: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="rcw-nw-cmd">
      {label && <div style={{ fontSize: 9, letterSpacing: ".16em", color: "rgb(84 230 255 / .7)", marginBottom: 5 }}>{label}</div>}
      <code>{cmd}</code>
      <button className="rcw-nw-btn" style={{ marginTop: 8, padding: "5px 12px", fontSize: 10 }}
        onClick={() => { navigator.clipboard.writeText(cmd); setDone(true); setTimeout(() => setDone(false), 1500); }}>
        {done ? "✓ COPIED" : "COPY"}
      </button>
    </div>
  );
}

export default function NewSessionWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>("server");
  const [servers, setServers] = useState<ServerView[]>([]);
  const [server, setServer] = useState<ServerView | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [newSrv, setNewSrv] = useState({ name: "", host: "", sshUser: "root", sshPort: 22 });
  const [closed, setClosed] = useState(false);

  const [provision, setProvision] = useState<{ installCommand: string; installCommandRelay: string } | null>(null);
  const [inv, setInv] = useState<{ hosts: HostRow[]; sessions: Discovered[] }>({ hosts: [], sessions: [] });

  const [resume, setResume] = useState<Discovered | null>(null);
  const [createNew, setCreateNew] = useState(false);
  const [folder, setFolder] = useState("~");
  const [mode, setMode] = useState<Mode>("normal");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { window.cowork.serversList().then(setServers).catch(() => {}); }, []);
  const refreshInv = useCallback(() => {
    window.cowork.getInventory().then((r) => setInv(r as { hosts: HostRow[]; sessions: Discovered[] })).catch(() => {});
  }, []);
  useEffect(() => { refreshInv(); }, [refreshInv]);

  // Match the chosen server to a reporting host (by address) → its discovered sessions.
  const host = useMemo(() => server ? inv.hosts.find((h) => h.address && (h.address === server.host || h.machine === server.name)) : null, [server, inv, ]);
  const hostSessions = useMemo(() => host ? inv.sessions.filter((s) => s.folder && inv.sessions && s.machine === host.machine) : [], [host, inv]);
  const redstoneInstalled = !!host;

  const idx = STEPS.indexOf(step);
  const go = (s: Step) => { setErr(""); setStep(s); };

  async function chooseServer(s: ServerView) {
    setServer(s); setResume(null); setCreateNew(false); setProvision(null);
    go("provision");
  }
  async function connectNew() {
    setBusy(true); setErr("");
    try {
      const created = await window.cowork.serverCreate({ ...newSrv, name: newSrv.name.trim(), host: newSrv.host.trim() });
      setServers((prev) => [...prev, created]); setConnecting(false);
      await chooseServer(created);
    } catch (e) { setErr(`Connect failed (${e instanceof Error ? e.message : e})`); }
    finally { setBusy(false); }
  }
  async function loadProvision() {
    if (!server) return;
    setBusy(true); setErr("");
    try { setProvision(await window.cowork.serverProvision(server.id)); }
    catch (e) { setErr(`Could not build install command (${e instanceof Error ? e.message : e})`); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (step === "provision" && server && !provision) void loadProvision(); }, [step, server]); // eslint-disable-line

  // The command to run on the server to start the session.
  const launchCmd = useMemo(() => {
    const flag = mode === "danger" ? " --dangerously-skip-permissions" : "";
    if (resume) return `redstone --resume ${resume.id}${flag}`;
    return `cd ${shq(folder)} && redstone hook && redstone claude${flag}`;
  }, [resume, folder, mode]);

  return (
    <div className="rcw-nw-scrim" onClick={onClose}>
      <style>{CSS}</style>
      <div className="rcw-nw no-scrollbar" onClick={(e) => e.stopPropagation()}>
        <div className="rcw-nw-head">
          <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".26em", color: "rgb(84 230 255 / .9)" }}>NEW SESSION</span>
          <span className="faint" style={{ fontSize: 9.5, letterSpacing: ".18em" }}>{server ? server.name : "SELECT TARGET"}</span>
          <span style={{ flex: 1 }} />
          <button className="rcw-nw-btn ghost" style={{ padding: "5px 12px", fontSize: 10 }} onClick={onClose}>ESC</button>
        </div>
        <div className="rcw-nw-steps">{STEPS.map((s, i) => <span key={s} className={`rcw-nw-dot ${i <= idx ? "on" : ""}`} />)}</div>

        <div className="rcw-nw-body">
          {err && <div style={{ color: "#ff7d72", fontSize: 11.5, marginBottom: 8 }}>⚠ {err}</div>}

          {step === "server" && (
            <>
              <div className="rcw-nw-label">SELECT SERVER</div>
              {servers.map((s) => (
                <div key={s.id} className="rcw-nw-opt" onClick={() => chooseServer(s)}>
                  <b style={{ color: "#e6f2f4" }}>{s.name}</b> <span className="faint">{s.sshUser}@{s.host}:{s.sshPort}</span>
                  {s.ownerAccountId ? <span style={{ color: "#7fd18b", fontSize: 9, marginLeft: 6 }}>MINE</span> : <span style={{ color: "rgb(84 230 255 / .7)", fontSize: 9, marginLeft: 6 }}>COMPANY</span>}
                </div>
              ))}
              {!connecting ? (
                <button className="rcw-nw-btn" style={{ marginTop: 6 }} onClick={() => setConnecting(true)}>＋ CONNECT NEW SERVER</button>
              ) : (
                <div className="rcw-nw-opt" style={{ cursor: "default" }}>
                  <div className="rcw-nw-label" style={{ marginTop: 0 }}>NAME</div>
                  <input className="rcw-nw-input" value={newSrv.name} onChange={(e) => setNewSrv({ ...newSrv, name: e.target.value })} placeholder="VPS Alpha" />
                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 2 }}><div className="rcw-nw-label">HOST / IP</div><input className="rcw-nw-input" value={newSrv.host} onChange={(e) => setNewSrv({ ...newSrv, host: e.target.value })} placeholder="10.0.0.1 (or hostname)" spellCheck={false} /></div>
                    <div style={{ flex: 1 }}><div className="rcw-nw-label">SSH USER</div><input className="rcw-nw-input" value={newSrv.sshUser} onChange={(e) => setNewSrv({ ...newSrv, sshUser: e.target.value })} /></div>
                    <div style={{ width: 66 }}><div className="rcw-nw-label">PORT</div><input className="rcw-nw-input" value={newSrv.sshPort} onChange={(e) => setNewSrv({ ...newSrv, sshPort: Number(e.target.value) || 22 })} /></div>
                  </div>
                  <label style={{ display: "flex", gap: 7, alignItems: "center", marginTop: 10, fontSize: 11, color: "var(--text-soft)", cursor: "pointer" }}>
                    <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
                    Closed / behind NAT (no inbound SSH — use reverse-SSH relay)
                  </label>
                  <button className="rcw-nw-btn" style={{ marginTop: 12 }} disabled={busy || !newSrv.name.trim() || !newSrv.host.trim()} onClick={connectNew}>{busy ? "…" : "ADD & CONTINUE"}</button>
                </div>
              )}
            </>
          )}

          {step === "provision" && server && (
            <>
              <div className="rcw-nw-label">REDSTONE ON {server.name.toUpperCase()}</div>
              {redstoneInstalled ? (
                <div style={{ color: "#7fd18b", fontSize: 12, padding: "6px 2px" }}>◈ Redstone agent is reporting from this server — ready.</div>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: "var(--text-soft)", lineHeight: 1.6, marginBottom: 4 }}>
                    Not detected yet. Run this on <b>{server.name}</b> to install redstone{closed ? " (reverse-SSH relay — for closed servers)" : ""}. It auto-installs the background agent and reports back here.
                  </div>
                  {provision && <Cmd cmd={closed ? provision.installCommandRelay : provision.installCommand} label={closed ? "RUN ON SERVER (REVERSE RELAY)" : "RUN ON SERVER"} />}
                  {provision && (
                    <label style={{ display: "flex", gap: 7, alignItems: "center", marginTop: 10, fontSize: 11, color: "var(--text-soft)", cursor: "pointer" }}>
                      <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
                      Closed / behind NAT — use the reverse-SSH relay command
                    </label>
                  )}
                  <button className="rcw-nw-btn ghost" style={{ marginTop: 10, padding: "6px 12px", fontSize: 10 }} onClick={refreshInv}>↻ CHECK AGAIN</button>
                </>
              )}
            </>
          )}

          {step === "session" && (
            <>
              <div className="rcw-nw-label">RESUME OR CREATE</div>
              <div className={`rcw-nw-opt ${createNew ? "sel" : ""}`} onClick={() => { setCreateNew(true); setResume(null); }}>
                <b style={{ color: "#e6f2f4" }}>＋ New session</b> <span className="faint">— pick a folder & mode next</span>
              </div>
              {hostSessions.length > 0 && <div className="rcw-nw-label">DISCOVERED CLAUDE SESSIONS</div>}
              {hostSessions.slice(0, 30).map((s) => (
                <div key={s.id} className={`rcw-nw-opt ${resume?.id === s.id ? "sel" : ""}`} onClick={() => { setResume(s); setCreateNew(false); }}>
                  <b style={{ color: "#e6f2f4" }}>{s.folder}</b> <span className="faint">{s.title ?? s.cwd}</span>
                </div>
              ))}
              {!hostSessions.length && <div className="faint" style={{ fontSize: 11 }}>No prior Claude sessions discovered on this server yet.</div>}
            </>
          )}

          {step === "folder" && (
            <>
              <div className="rcw-nw-label">{resume ? "SESSION FOLDER" : "FOLDER ON SERVER"}</div>
              {resume ? (
                <div style={{ fontSize: 12, color: "var(--text-soft)" }}>{resume.cwd}</div>
              ) : (
                <>
                  <input className="rcw-nw-input" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="~/projects/my-app" spellCheck={false} />
                  <div className="faint" style={{ fontSize: 10.5, marginTop: 6 }}>Absolute path or ~ — the session starts (and redstone hooks) here.</div>
                </>
              )}
            </>
          )}

          {step === "mode" && (
            <>
              <div className="rcw-nw-label">PERMISSION MODE</div>
              <div className={`rcw-nw-opt ${mode === "normal" ? "sel" : ""}`} onClick={() => setMode("normal")}>
                <b style={{ color: "#e6f2f4" }}>Normal</b> <span className="faint">— Claude asks before running tools</span>
              </div>
              <div className={`rcw-nw-opt ${mode === "danger" ? "sel" : ""}`} onClick={() => setMode("danger")}>
                <b style={{ color: "#e0a24a" }}>Dangerously Skip Permissions</b> <span className="faint">— auto-runs everything (--dangerously-skip-permissions)</span>
              </div>
            </>
          )}

          {step === "launch" && (
            <>
              <div className="rcw-nw-label">LAUNCH</div>
              <div style={{ fontSize: 12, color: "var(--text-soft)", lineHeight: 1.6, marginBottom: 6 }}>
                Run this on <b>{server?.name}</b> to {resume ? "resume" : "start"} the session in
                {" "}<b>{mode === "danger" ? "DANGEROUS" : "normal"}</b> mode. It appears in your cockpit once it connects.
              </div>
              <Cmd cmd={launchCmd} label="RUN ON SERVER" />
              <div className="faint" style={{ fontSize: 10.5, marginTop: 10 }}>
                Tip: SSH in ({server?.sshUser}@{server?.host}{server?.sshPort !== 22 ? `:${server?.sshPort}` : ""}) and paste — or run it in any terminal on that machine.
              </div>
            </>
          )}
        </div>

        <div className="rcw-nw-foot">
          <button className="rcw-nw-btn ghost" disabled={idx === 0} onClick={() => go(STEPS[idx - 1])}>← BACK</button>
          {step === "launch" ? (
            <button className="rcw-nw-btn" onClick={onClose}>DONE</button>
          ) : (
            <button className="rcw-nw-btn"
              disabled={
                (step === "server" && !server) ||
                (step === "session" && !resume && !createNew) ||
                (step === "folder" && !resume && !folder.trim())
              }
              onClick={() => {
                if (step === "provision" && !redstoneInstalled) { refreshInv(); }
                go(STEPS[Math.min(idx + 1, STEPS.length - 1)]);
              }}>
              {step === "provision" && !redstoneInstalled ? "SKIP — I'LL INSTALL →" : "NEXT →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
