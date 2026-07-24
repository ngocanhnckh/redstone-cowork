import { useCallback, useEffect, useRef, useState } from "react";
import yiaSealUrl from "./assets/yia-seal.png?url";
import { describeFace, loadFaceModels } from "./faceEngine";
import { loadAppearance, saveAppearance } from "./appearance";

interface LoginProps {
  onConnected: () => void;
}

type Mode = "agency" | "redstone" | "token" | "faceunlock";
type ScanPhase = "idle" | "acquiring" | "scanning" | "locked" | "denied";

// ————— YITEC INTELLIGENCE AGENCY login —————
// A sci-fi credential gate: camera face-scan sequence (identification visual — the
// biometric MATCH ships with the enrollment slice; auth is always account+password),
// then agent credentials. Falls back to Redstone SSO / instance-token modes.

const CSS = `
@keyframes yia-in { from { opacity:0; transform: translateY(10px); } to { opacity:1; transform:none; } }
@keyframes yia-flicker { 0%,100% { opacity:1; } 92% { opacity:1; } 94% { opacity:.55; } 96% { opacity:1; } }
@keyframes yia-sweep { 0% { top:-6%; } 100% { top:104%; } }
@keyframes yia-ring { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes yia-ring-rev { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
@keyframes yia-pulse { 0%,100% { opacity:.35; } 50% { opacity:.9; } }
@keyframes yia-grid-drift { from { background-position: 0 0; } to { background-position: 0 44px; } }
.yia-root { min-height:100vh; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden;
  font-family: var(--font-mono, "SF Mono", ui-monospace, monospace); }
.yia-grid { position:absolute; inset:0; pointer-events:none; opacity:.16;
  background-image: linear-gradient(rgb(84 230 255 / .25) 1px, transparent 1px), linear-gradient(90deg, rgb(84 230 255 / .25) 1px, transparent 1px);
  background-size: 44px 44px; animation: yia-grid-drift 6s linear infinite;
  mask-image: radial-gradient(ellipse 90% 75% at 50% 45%, black 30%, transparent 75%); -webkit-mask-image: radial-gradient(ellipse 90% 75% at 50% 45%, black 30%, transparent 75%); }
.yia-card { position:relative; z-index:2; width:480px; max-width:94vw; padding:34px 38px 30px; border-radius:16px;
  border:1px solid rgb(84 230 255 / .28); background: rgb(8 14 20 / .72);
  -webkit-backdrop-filter: blur(26px) saturate(1.3); backdrop-filter: blur(26px) saturate(1.3);
  box-shadow: 0 0 60px -18px rgb(84 230 255 / .5), inset 0 0 40px -30px rgb(84 230 255 / .6);
  animation: yia-in .5s ease both; }
.yia-corner { position:absolute; width:16px; height:16px; border-color: rgb(84 230 255 / .85); border-style:solid; }
.yia-kicker { font-size:10px; letter-spacing:.42em; color: rgb(84 230 255 / .8); animation: yia-flicker 7s linear infinite; }
.yia-title { font-size:21px; font-weight:700; letter-spacing:.14em; color:#e6f2f4; margin:6px 0 2px; }
.yia-sub { font-size:10.5px; letter-spacing:.2em; color: rgb(230 242 244 / .45); }
.yia-scanwrap { position:relative; width:168px; height:168px; margin:20px auto 6px; }
.yia-ring { position:absolute; inset:0; border-radius:50%; border:1px dashed rgb(84 230 255 / .5); animation: yia-ring 14s linear infinite; }
.yia-ring2 { position:absolute; inset:10px; border-radius:50%; border:1px solid rgb(84 230 255 / .25);
  border-top-color: rgb(84 230 255 / .9); animation: yia-ring-rev 3.2s linear infinite; }
.yia-cam { position:absolute; inset:20px; border-radius:50%; overflow:hidden; border:1px solid rgb(84 230 255 / .45);
  background:#03080c; display:flex; align-items:center; justify-content:center; }
.yia-cam video { width:100%; height:100%; object-fit:cover; transform: scaleX(-1); filter: saturate(.7) contrast(1.1) brightness(.95); }
.yia-sweepline { position:absolute; left:6%; right:6%; height:2px; z-index:3; border-radius:2px;
  background: linear-gradient(90deg, transparent, rgb(84 230 255 / .95), transparent);
  box-shadow: 0 0 18px 3px rgb(84 230 255 / .55); animation: yia-sweep 1.15s ease-in-out infinite alternate; }
.yia-status { text-align:center; font-size:10.5px; letter-spacing:.24em; min-height:16px; margin-bottom:14px; }
.yia-label { display:block; font-size:9.5px; letter-spacing:.3em; color: rgb(84 230 255 / .75); margin: 0 0 6px 2px; }
.yia-input { width:100%; box-sizing:border-box; padding:11px 14px; border-radius:8px; font-size:14px; letter-spacing:.06em;
  border:1px solid rgb(84 230 255 / .3); background: rgb(84 230 255 / .05); color:#e6f2f4; outline:none;
  font-family: inherit; transition: border-color .15s, box-shadow .15s; }
.yia-input:focus { border-color: rgb(84 230 255 / .8); box-shadow: 0 0 0 1px rgb(84 230 255 / .35), 0 0 22px -6px rgb(84 230 255 / .5); }
.yia-btn { width:100%; padding:13px 0; margin-top:18px; border-radius:9px; border:1px solid rgb(84 230 255 / .7);
  background: linear-gradient(180deg, rgb(84 230 255 / .22), rgb(84 230 255 / .1)); color:#d9f7ff;
  font-family:inherit; font-size:13px; font-weight:700; letter-spacing:.3em; cursor:pointer;
  text-shadow: 0 0 12px rgb(84 230 255 / .8); transition: box-shadow .15s, background .15s; }
.yia-btn:hover:not(:disabled) { box-shadow: 0 0 30px -6px rgb(84 230 255 / .8); background: linear-gradient(180deg, rgb(84 230 255 / .3), rgb(84 230 255 / .14)); }
.yia-btn:disabled { opacity:.4; cursor:not-allowed; }
.yia-jira { width:100%; padding:11px 0; margin-top:12px; border-radius:9px; border:1px solid rgb(38 132 255 / .6);
  background: linear-gradient(180deg, rgb(38 132 255 / .22), rgb(38 132 255 / .1)); color:#cfe4ff;
  font-family:inherit; font-size:12px; font-weight:700; letter-spacing:.22em; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:9px;
  text-shadow:0 0 12px rgb(38 132 255 / .7); transition: box-shadow .15s, background .15s; }
.yia-jira:hover:not(:disabled) { box-shadow:0 0 28px -6px rgb(38 132 255 / .85); background: linear-gradient(180deg, rgb(38 132 255 / .3), rgb(38 132 255 / .14)); }
.yia-jira:disabled { opacity:.5; cursor:progress; }
.yia-or { display:flex; align-items:center; gap:10px; margin:14px 0 2px; color: rgb(230 242 244 / .3); font-size:9px; letter-spacing:.3em; }
.yia-or::before, .yia-or::after { content:""; flex:1; height:1px; background: rgb(84 230 255 / .18); }
.yia-alt { background:none; border:none; color: rgb(230 242 244 / .4); font-family:inherit; font-size:10px;
  letter-spacing:.18em; cursor:pointer; padding:4px 8px; }
.yia-alt:hover { color: rgb(84 230 255 / .85); }
.yia-err { color:#ff7d72; font-size:11.5px; letter-spacing:.06em; margin-top:12px; line-height:1.5; }
`;

const CYAN = "rgb(84 230 255)";

function Corners() {
  return (
    <>
      <span className="yia-corner" style={{ top: -1, left: -1, borderWidth: "2px 0 0 2px", borderTopLeftRadius: 6 }} />
      <span className="yia-corner" style={{ top: -1, right: -1, borderWidth: "2px 2px 0 0", borderTopRightRadius: 6 }} />
      <span className="yia-corner" style={{ bottom: -1, left: -1, borderWidth: "0 0 2px 2px", borderBottomLeftRadius: 6 }} />
      <span className="yia-corner" style={{ bottom: -1, right: -1, borderWidth: "0 2px 2px 0", borderBottomRightRadius: 6 }} />
    </>
  );
}

export default function Login({ onConnected }: LoginProps) {
  const [serverUrl, setServerUrl] = useState("https://cowork.chatredstone.com");
  const [enrollFace, setEnrollFace] = useState(true); // show the face scan + enroll by default
  const [soundOn, setSoundOn] = useState(() => { try { return loadAppearance().sfxVolume > 0; } catch { return false; } });
  const [mode, setMode] = useState<Mode>("agency");
  const [redstoneOn, setRedstoneOn] = useState(false);
  const [accountsOn, setAccountsOn] = useState(false);
  const [jiraOn, setJiraOn] = useState(false);
  const [jiraBusy, setJiraBusy] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [showServer, setShowServer] = useState(false);

  // — face-scan sequence —
  const [scan, setScan] = useState<ScanPhase>("idle");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // — face biometric unlock (this device is paired to an agent) —
  const [deviceAgent, setDeviceAgent] = useState<{ username: string; displayName: string; photo: string | null } | null>(null);
  const [faceMsg, setFaceMsg] = useState("LOOK AT THE CAMERA");
  const faceTriedRef = useRef(false);

  const stopCam = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startScan = useCallback(async () => {
    setScan("acquiring");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 480 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setScan("scanning");
      // Sweep for ~2.6s, then lock. (Real embedding match lands with enrollment.)
      setTimeout(() => setScan((s) => (s === "scanning" ? "locked" : s)), 2600);
    } catch {
      setScan("denied"); // no camera / permission refused — credentials still work
    }
  }, []);

  useEffect(() => () => stopCam(), [stopCam]);

  // Ask the server (as the URL changes) which sign-in modes it offers.
  useEffect(() => {
    const url = serverUrl.trim();
    if (!url) { setRedstoneOn(false); setAccountsOn(false); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      window.cowork.authConfig(url).then((c) => {
        if (cancelled) return;
        setRedstoneOn(!!c.redstone);
        setAccountsOn(!!c.accounts);
        setJiraOn(!!c.jira);
        setOrgName(c.orgName ?? null);
        if (c.accounts) setMode("agency");
        else if (c.redstone) setMode("redstone");
        else setMode("token");
      }).catch(() => {});
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [serverUrl]);

  // Camera runs ONLY for face unlock (its own effect) or when the user opts into
  // face enrollment. Otherwise agency mode is a plain credential form — no camera,
  // so an agent with no face on file just signs in right away.
  useEffect(() => {
    if (mode === "agency" && enrollFace && scan === "idle") void startScan();
    if (!enrollFace && (mode === "agency" || mode === "redstone" || mode === "token")) { stopCam(); setScan("idle"); }
  }, [mode, scan, enrollFace, startScan, stopCam]);

  const canSubmit =
    serverUrl.trim().length > 0 && !connecting &&
    (mode === "token" ? token.trim().length > 0 : username.trim().length > 0 && password.length > 0);

  // On mount: is this device paired for face unlock? If so, default to that mode.
  useEffect(() => {
    window.cowork.deviceTrust().then((t) => {
      if (t) {
        setDeviceAgent({ username: t.username, displayName: t.displayName, photo: t.photo });
        setServerUrl(t.serverUrl);
        setMode("faceunlock");
        void loadFaceModels().catch(() => {});
      }
    }).catch(() => {});
  }, []);

  // Face unlock: once the scan visual locks, grab a frame, describe it, sign in.
  const attemptFaceUnlock = useCallback(async () => {
    if (faceTriedRef.current || !videoRef.current) return;
    faceTriedRef.current = true;
    setFaceMsg("MATCHING BIOMETRIC SIGNATURE…");
    try {
      await loadFaceModels();
      let descriptor: number[] | null = null;
      for (let i = 0; i < 5 && !descriptor; i++) {
        descriptor = await describeFace(videoRef.current);
        if (!descriptor) await new Promise((r) => setTimeout(r, 400));
      }
      if (!descriptor) { setFaceMsg("NO FACE DETECTED — center your face, or use credentials"); faceTriedRef.current = false; return; }
      const r = await window.cowork.faceLogin(descriptor);
      if (r.ok) { setFaceMsg("◈ IDENTITY CONFIRMED"); stopCam(); return onConnected(); }
      setFaceMsg(`⚠ ${r.error === "face_no-match" ? "FACE NOT RECOGNIZED" : (r.error ?? "unlock failed")} — try again or use credentials`);
      faceTriedRef.current = false;
    } catch (e) {
      setFaceMsg(`⚠ ${e instanceof Error ? e.message : "unlock error"} — use credentials`);
      faceTriedRef.current = false;
    }
  }, [onConnected, stopCam]);

  // Drive the scan sequence in face-unlock mode, then attempt the match.
  useEffect(() => {
    if (mode !== "faceunlock") return;
    faceTriedRef.current = false;
    void startScan();
    const t = setTimeout(() => void attemptFaceUnlock(), 2800);
    return () => clearTimeout(t);
  }, [mode, startScan, attemptFaceUnlock]);

  // After a full login, silently enroll the live face so next time is face-only.
  async function maybeEnrollFace(account: { username: string; displayName: string }) {
    try {
      if (!enrollFace) return; // opt-in only — otherwise we never touched the camera
      const existing = await window.cowork.deviceTrust();
      if (existing?.username === account.username) return; // already paired
      if (!videoRef.current) return;
      await loadFaceModels();
      let descriptor: number[] | null = null;
      for (let i = 0; i < 4 && !descriptor; i++) {
        descriptor = await describeFace(videoRef.current);
        if (!descriptor) await new Promise((r) => setTimeout(r, 350));
      }
      if (descriptor) await window.cowork.faceEnroll(descriptor, { username: account.username, displayName: account.displayName });
    } catch { /* enrollment is best-effort — never blocks sign-in */ }
  }

  function toggleSound() {
    const on = !soundOn;
    setSoundOn(on);
    try { const a = loadAppearance(); saveAppearance({ ...a, sfxVolume: on ? 50 : 0 }); } catch { /* ignore */ }
  }

  async function signInWithJira() {
    setJiraBusy(true);
    setError("");
    try {
      const r = await window.cowork.jiraOAuthLogin(serverUrl.trim());
      if (r.ok) { await maybeEnrollFace(r.account ?? { username: "agent", displayName: "Agent" }); stopCam(); return onConnected(); }
      setError(r.error ?? "Jira sign-in failed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setJiraBusy(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setConnecting(true);
    setError("");
    try {
      if (mode === "agency") {
        const r = await window.cowork.accountLogin(serverUrl.trim(), username.trim(), password);
        if (r.ok) { await maybeEnrollFace(r.account ?? { username: username.trim(), displayName: username.trim() }); stopCam(); return onConnected(); }
        setError(r.error ?? "ACCESS DENIED — credentials rejected.");
      } else if (mode === "redstone") {
        const r = await window.cowork.redstoneLogin(serverUrl.trim(), username.trim(), password);
        if (r.ok) return onConnected();
        const msg = r.error ?? "Sign-in failed.";
        setError(/server[_ ]?error|unexpected|500|502|503|504/i.test(msg)
          ? `${msg} — the Redstone sign-in service looks unavailable. Use instance-token access instead.`
          : msg);
      } else {
        await window.cowork.saveConfig(serverUrl.trim(), token.trim());
        onConnected();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }

  const scanStatus: Record<ScanPhase, { text: string; color: string }> = {
    idle: { text: "", color: CYAN },
    acquiring: { text: "▲ ACQUIRING OPTICS…", color: CYAN },
    scanning: { text: "SCANNING BIOMETRIC SIGNATURE…", color: CYAN },
    locked: { text: "◈ IDENTITY CAPTURED — ENTER CREDENTIALS", color: "#7fd18b" },
    denied: { text: "OPTICS OFFLINE — CREDENTIAL ACCESS ONLY", color: "#e0a24a" },
  };

  return (
    <div data-app className="yia-root" style={{ background: "radial-gradient(ellipse 120% 90% at 50% 0%, #0a1620 0%, #050a10 55%, #030608 100%)" }}>
      <style>{CSS}</style>
      <div className="yia-grid" />
      {/* Agency seal — giant translucent watermark behind the terminal card. */}
      <img
        src={yiaSealUrl}
        alt=""
        aria-hidden
        style={{
          position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
          width: "min(78vh, 820px)", opacity: 0.06, pointerEvents: "none", userSelect: "none",
          filter: "drop-shadow(0 0 60px rgb(84 230 255 / 0.25))",
        }}
      />

      <div className="yia-card">
        <Corners />

        <div style={{ textAlign: "center" }}>
          <img
            src={yiaSealUrl}
            alt="YITEC Intelligence Agency seal"
            style={{ width: 88, height: 88, margin: "0 auto 10px", display: "block", filter: "drop-shadow(0 0 18px rgb(84 230 255 / 0.45))" }}
          />
          <span className="yia-kicker">{orgName?.toUpperCase() ?? "YITEC INTELLIGENCE AGENCY"}</span>
          <div className="yia-title">SECURE ACCESS TERMINAL</div>
          <div className="yia-sub">REDSTONE COWORK · CLEARANCE REQUIRED</div>
        </div>

        {mode === "faceunlock" && deviceAgent ? (
          <div>
            <div className="yia-scanwrap">
              <span className="yia-ring" />
              <span className="yia-ring2" style={{ animationPlayState: scan === "scanning" || scan === "acquiring" ? "running" : "paused" }} />
              <div className="yia-cam">
                {scan === "denied" ? <span style={{ fontSize: 34, opacity: 0.35 }}>⎚</span> : <video ref={videoRef} muted playsInline />}
                {scan === "scanning" && <span className="yia-sweepline" />}
              </div>
            </div>
            <div style={{ textAlign: "center", marginTop: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: ".08em", color: "#e6f2f4" }}>{deviceAgent.displayName}</div>
              <div className="yia-sub" style={{ marginTop: 2 }}>@{deviceAgent.username}</div>
            </div>
            <div className="yia-status" style={{ marginTop: 14, color: faceMsg.startsWith("⚠") ? "#e0a24a" : faceMsg.startsWith("◈") ? "#7fd18b" : CYAN }}>{faceMsg}</div>
            <button type="button" className="yia-btn" onClick={() => { faceTriedRef.current = false; void attemptFaceUnlock(); }}>RESCAN</button>
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button type="button" className="yia-alt" onClick={() => { setMode("agency"); setError(""); }}>USE CREDENTIALS INSTEAD</button>
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit}>
          {mode === "agency" ? (
            <>
              {enrollFace && (
                <>
                  <div className="yia-scanwrap">
                    <span className="yia-ring" />
                    <span className="yia-ring2" style={{ animationPlayState: scan === "scanning" || scan === "acquiring" ? "running" : "paused" }} />
                    <div className="yia-cam">
                      {scan === "denied" ? <span style={{ fontSize: 34, opacity: 0.35 }}>⎚</span> : <video ref={videoRef} muted playsInline />}
                      {scan === "scanning" && <span className="yia-sweepline" />}
                    </div>
                  </div>
                  <div className="yia-status" style={{ color: scanStatus[scan].color }}>{scanStatus[scan].text}</div>
                </>
              )}

              <div style={{ marginBottom: 13 }}>
                <label className="yia-label">AGENT ID</label>
                {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
                <input className="yia-input" autoFocus value={username} onChange={(e) => setUsername(e.target.value)}
                  placeholder="firstname.lastname" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              </div>
              <div>
                <label className="yia-label">ACCESS CODE</label>
                <input className="yia-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••" autoComplete="current-password" />
              </div>
              <label style={{ display: "flex", gap: 7, alignItems: "center", marginTop: 12, fontSize: 10.5, letterSpacing: ".12em", color: "rgb(230 242 244 / .5)", cursor: "pointer" }}>
                <input type="checkbox" checked={enrollFace} onChange={(e) => setEnrollFace(e.target.checked)} />
                ENABLE FACE SIGN-IN ON THIS DEVICE (scans your face after login)
              </label>
            </>
          ) : mode === "redstone" ? (
            <>
              <div style={{ margin: "22px 0 13px" }}>
                <label className="yia-label">REDSTONE USERNAME</label>
                <input className="yia-input" value={username} onChange={(e) => setUsername(e.target.value)}
                  placeholder="you@yourorg" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              </div>
              <div>
                <label className="yia-label">PASSWORD</label>
                <input className="yia-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </div>
            </>
          ) : (
            <div style={{ margin: "22px 0 0" }}>
              <label className="yia-label">INSTANCE TOKEN</label>
              <input className="yia-input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="INSTANCE_TOKEN" />
            </div>
          )}

          {showServer && (
            <div style={{ marginTop: 13 }}>
              <label className="yia-label">SERVER ENDPOINT</label>
              <input className="yia-input" type="url" value={serverUrl} onChange={(e) => setServerUrl(e.target.value)} placeholder="https://cowork.example.com" />
            </div>
          )}

          <button type="submit" className="yia-btn" disabled={!canSubmit}>
            {connecting ? "AUTHENTICATING…" : mode === "agency" ? "REQUEST ACCESS" : mode === "redstone" ? "SIGN IN" : "CONNECT"}
          </button>

          {jiraOn && mode === "agency" && (
            <>
              <div className="yia-or">OR</div>
              <button type="button" className="yia-jira" onClick={signInWithJira} disabled={jiraBusy || connecting}>
                <svg width="15" height="15" viewBox="0 0 32 32" fill="currentColor" aria-hidden><path d="M16.4 2 6 12.4a1.4 1.4 0 0 0 0 2l10.4 10.4 4-4-8.4-8.4 4-4a1.4 1.4 0 0 0 0-2L16.4 2z"/><path opacity=".7" d="M25.6 11.2 20 16.8l-4 4 5.6 5.6a1.4 1.4 0 0 0 2 0l6-6a1.4 1.4 0 0 0 0-2l-4-7.2z"/></svg>
                {jiraBusy ? "AWAITING JIRA CONSENT…" : "SIGN IN WITH JIRA"}
              </button>
            </>
          )}
          {error && <p className="yia-err">⚠ {error}</p>}
        </form>
        )}

        <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 16, flexWrap: "wrap" }}>
          {deviceAgent && mode !== "faceunlock" && <button className="yia-alt" onClick={() => { setMode("faceunlock"); setError(""); }}>◈ FACE UNLOCK</button>}
          {accountsOn && mode !== "agency" && <button className="yia-alt" onClick={() => { setMode("agency"); setError(""); }}>AGENT LOGIN</button>}
          {redstoneOn && mode !== "redstone" && <button className="yia-alt" onClick={() => { setMode("redstone"); setError(""); }}>REDSTONE SSO</button>}
          {mode !== "token" && <button className="yia-alt" onClick={() => { setMode("token"); setError(""); }}>INSTANCE TOKEN</button>}
          <button className="yia-alt" onClick={toggleSound}>{soundOn ? "🔊 SOUND ON" : "🔇 SOUND OFF"}</button>
          <button className="yia-alt" onClick={() => setShowServer((s) => !s)}>{showServer ? "HIDE SERVER" : "SERVER"}</button>
        </div>
      </div>
    </div>
  );
}
