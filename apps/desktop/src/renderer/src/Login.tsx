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
@keyframes yia-sweep { 0% { top:-6%; } 100% { top:104%; } }
@keyframes yia-ring { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes yia-ring-rev { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
@keyframes yia-grid-drift { from { background-position: 0 0; } to { background-position: 0 44px; } }
.yia-root { min-height:100vh; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden;
  font-family: var(--font-mono, "SF Mono", ui-monospace, monospace); }
.yia-grid { position:absolute; inset:0; pointer-events:none; opacity:.16;
  background-image: linear-gradient(rgba(232,230,225,.25) 1px, transparent 1px), linear-gradient(90deg, rgba(232,230,225,.25) 1px, transparent 1px);
  background-size: 44px 44px; animation: yia-grid-drift 6s linear infinite;
  mask-image: radial-gradient(ellipse 90% 75% at 50% 45%, black 30%, transparent 75%); -webkit-mask-image: radial-gradient(ellipse 90% 75% at 50% 45%, black 30%, transparent 75%); }
.yia-card { position:relative; z-index:2; width:480px; max-width:94vw; padding:34px 38px 30px; border-radius:16px;
  border:1px solid rgba(232,230,225,.28); background: rgb(8 14 20 / .72);
  -webkit-backdrop-filter: blur(26px) saturate(1.3); backdrop-filter: blur(26px) saturate(1.3);
  animation: yia-in .5s ease both; }
.yia-corner { position:absolute; width:16px; height:16px; border-color: rgba(232,230,225,.85); border-style:solid; }
.yia-kicker { font-size:10px; letter-spacing:.42em; color: var(--text-soft); }
.yia-title { font-size:21px; font-weight:700; letter-spacing:.14em; color:var(--text); margin:6px 0 2px; }
.yia-sub { font-size:10.5px; letter-spacing:.2em; color: rgb(230 242 244 / .45); }
.yia-scanwrap { position:relative; width:168px; height:168px; margin:20px auto 6px; }
.yia-ring { position:absolute; inset:0; border-radius:50%; border:1px dashed rgba(232,230,225,.5); animation: yia-ring 14s linear infinite; }
.yia-ring2 { position:absolute; inset:10px; border-radius:50%; border:1px solid rgba(232,230,225,.25);
  border-top-color: var(--text); animation: yia-ring-rev 3.2s linear infinite; }
.yia-cam { position:absolute; inset:20px; border-radius:50%; overflow:hidden; border:1px solid rgba(232,230,225,.45);
  background:#03080c; display:flex; align-items:center; justify-content:center; }
.yia-cam video { width:100%; height:100%; object-fit:cover; transform: scaleX(-1); filter: saturate(.7) contrast(1.1) brightness(.95); }
.yia-sweepline { position:absolute; left:6%; right:6%; height:2px; z-index:3; border-radius:2px;
  background: rgba(232,230,225,.95); animation: yia-sweep 1.15s ease-in-out infinite alternate; }
.yia-status { text-align:center; font-size:10.5px; letter-spacing:.24em; min-height:16px; margin-bottom:14px; }
.yia-label { display:block; font-size:9.5px; letter-spacing:.3em; color: var(--text-soft); margin: 0 0 6px 2px; }
.yia-input { width:100%; box-sizing:border-box; padding:11px 14px; border-radius:8px; font-size:14px; letter-spacing:.06em;
  border:1px solid rgba(232,230,225,.3); background: rgba(232,230,225,.05); color:var(--text); outline:none;
  font-family: inherit; transition: border-color .15s; }
.yia-input:focus { border-color: rgba(232,230,225,.8); }
.yia-btn { width:100%; padding:13px 0; margin-top:18px; border-radius:9px; border:1px solid var(--text);
  background: var(--text); color:#0a0a0a;
  font-family:inherit; font-size:13px; font-weight:700; letter-spacing:.3em; cursor:pointer;
  transition: background .15s, border-color .15s; }
.yia-btn:hover:not(:disabled) { background:#e63b2e; border-color:#e63b2e; }
.yia-btn:disabled { opacity:.4; cursor:not-allowed; }
.yia-alt { background:none; border:none; color: rgb(230 242 244 / .4); font-family:inherit; font-size:10px;
  letter-spacing:.18em; cursor:pointer; padding:4px 8px; }
.yia-alt:hover { color: var(--text); }
.yia-err { color:#e63b2e; font-size:11.5px; letter-spacing:.06em; margin-top:12px; line-height:1.5; }
`;

const CYAN = "var(--text)";

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
  // Face enrollment moved to Settings ("Face sign-in"). Turning the camera on before a
  // first-time user has typed anything asks for biometrics from someone who does not yet
  // have an account — enrolling is a preference, not a credential.
  const [showMore, setShowMore] = useState(false); // secondary sign-in methods, collapsed
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
    // Only face UNLOCK uses the camera, and that only exists once this device is
    // already paired — i.e. never on a first-time sign-in.
    if (mode === "agency" || mode === "redstone" || mode === "token") { stopCam(); setScan("idle"); }
  }, [mode, stopCam]);

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

  // Run after any successful ACCOUNT login: opt-in camera enrollment, then trust this
  // device so the lock screen can face-match against an existing descriptor (e.g. one
  // an admin pre-enrolled from the agent's roster photo). Both are best-effort.
  async function finishAuth(_account: { username: string; displayName: string }) {
    // No face capture here any more — Settings › Face sign-in does that on request.
    // Device trust still runs so that, once enrolled, this machine can face-unlock.
    try { await window.cowork.deviceTrustEstablish(); } catch { /* best-effort */ }
    stopCam();
    onConnected();
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
      if (r.ok) return finishAuth(r.account ?? { username: "agent", displayName: "Agent" });
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
        if (r.ok) return finishAuth(r.account ?? { username: username.trim(), displayName: username.trim() });
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
        }}
      />

      <div className="yia-card">
        <Corners />

        <div style={{ textAlign: "center" }}>
          <img
            src={yiaSealUrl}
            alt="YITEC Intelligence Agency seal"
            style={{ width: 88, height: 88, margin: "0 auto 10px", display: "block" }}
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
              <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: ".08em", color: "var(--text)" }}>{deviceAgent.displayName}</div>
              <div className="yia-sub" style={{ marginTop: 2 }}>@{deviceAgent.username}</div>
            </div>
            <div className="yia-status" style={{ marginTop: 14, color: faceMsg.startsWith("⚠") ? "#e63b2e" : faceMsg.startsWith("◈") ? "var(--text-soft)" : CYAN }}>{faceMsg}</div>
            <button type="button" className="yia-btn" onClick={() => { faceTriedRef.current = false; void attemptFaceUnlock(); }}>RESCAN</button>
            <div style={{ textAlign: "center", marginTop: 12 }}>
              <button type="button" className="yia-alt" onClick={() => { setMode("agency"); setError(""); }}>USE CREDENTIALS INSTEAD</button>
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit}>
          {/* Primary path: one button. Everything a first-time agent needs is their
              Jira account, so that's the whole form until they ask for more. */}
          {jiraOn && mode === "agency" && (
            <>
              <button type="button" className="yia-btn" style={{ marginTop: 22 }} onClick={signInWithJira} disabled={jiraBusy || connecting}>
                {jiraBusy ? "AWAITING JIRA CONSENT…" : "SIGN IN WITH JIRA"}
              </button>
              {!showMore && (
                <div style={{ textAlign: "center", marginTop: 14 }}>
                  <button type="button" className="yia-alt" onClick={() => setShowMore(true)}>OTHER WAYS TO SIGN IN</button>
                </div>
              )}
            </>
          )}

          {mode === "agency" ? (
            (!jiraOn || showMore) && (
            <>
              <div style={{ marginBottom: 13, marginTop: 22 }}>
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
            </>
            )
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

          {(mode !== "agency" || !jiraOn || showMore) && (
            <button type="submit" className="yia-btn" disabled={!canSubmit}>
              {connecting ? "AUTHENTICATING…" : mode === "agency" ? "REQUEST ACCESS" : mode === "redstone" ? "SIGN IN" : "CONNECT"}
            </button>
          )}
          {error && <p className="yia-err">{error}</p>}
        </form>
        )}

        {/* Alternate methods stay out of the way until asked for. Face unlock is the one
            exception: if this device is already paired it belongs to a RETURNING user,
            which is not the first-run case this screen is optimised for. */}
        <div style={{ display: "flex", justifyContent: "center", gap: 4, marginTop: 16, flexWrap: "wrap" }}>
          {deviceAgent && mode !== "faceunlock" && <button className="yia-alt" onClick={() => { setMode("faceunlock"); setError(""); }}>FACE UNLOCK</button>}
          {(showMore || !jiraOn || mode !== "agency") && (
            <>
              {accountsOn && mode !== "agency" && <button className="yia-alt" onClick={() => { setMode("agency"); setError(""); }}>AGENT LOGIN</button>}
              {redstoneOn && mode !== "redstone" && <button className="yia-alt" onClick={() => { setMode("redstone"); setError(""); }}>REDSTONE SSO</button>}
              {mode !== "token" && <button className="yia-alt" onClick={() => { setMode("token"); setError(""); }}>INSTANCE TOKEN</button>}
              <button className="yia-alt" onClick={toggleSound}>{soundOn ? "SOUND ON" : "SOUND OFF"}</button>
              <button className="yia-alt" onClick={() => setShowServer((s) => !s)}>{showServer ? "HIDE SERVER" : "SERVER"}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
