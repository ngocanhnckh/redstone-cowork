import { useCallback, useEffect, useRef, useState } from "react";
import { describeFace, loadFaceModels } from "./faceEngine";

// Quick-unlock lock screen shown on app launch / after the away-timeout when an
// agent session is stored. The session token stays put — this just re-verifies the
// person with FACE (if the device is enrolled) or a PIN. If the agent has no PIN and
// no enrolled face, they're prompted to set a PIN now (first-time setup).

interface Props {
  onUnlock: () => void;
  onSignOut: () => void;
}
type Agent = { displayName: string; username: string; photo: string | null; hasPin: boolean };

export default function LockScreen({ onUnlock, onSignOut }: Props) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [faceReady, setFaceReady] = useState(false);
  const [mode, setMode] = useState<"pin" | "setpin">("pin");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("LOOK AT THE CAMERA OR ENTER PIN");
  const [err, setErr] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const faceTried = useRef(false);

  const stopCam = useCallback(() => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; }, []);

  // Load identity + whether face unlock is available on this device.
  useEffect(() => {
    (async () => {
      try {
        const me = await window.cowork.accountsMe();
        const trust = await window.cowork.deviceTrust().catch(() => null);
        if (me && "username" in me && me.username) {
          const a = me as { displayName: string; username: string; photo?: string | null; hasPin?: boolean };
          const ag: Agent = { displayName: a.displayName || a.username, username: a.username, photo: a.photo ?? null, hasPin: !!a.hasPin };
          setAgent(ag);
          setFaceReady(!!trust);
          if (!ag.hasPin && !trust) { setMode("setpin"); setMsg("SET A 4–8 DIGIT UNLOCK PIN"); }
        }
      } catch { /* fall back to sign out */ }
    })();
  }, []);

  // Face unlock loop (only if the device is enrolled).
  useEffect(() => {
    if (!faceReady || mode !== "pin") return;
    let alive = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 480 }, audio: false });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        await loadFaceModels();
        // Try to match for ~2.5s after the camera warms up.
        setTimeout(() => void tryFace(), 1800);
      } catch { setMsg("ENTER PIN"); }
    })();
    return () => { alive = false; stopCam(); };
  }, [faceReady, mode]); // eslint-disable-line

  async function tryFace() {
    if (faceTried.current || !videoRef.current) return;
    faceTried.current = true;
    setMsg("MATCHING BIOMETRIC SIGNATURE…");
    try {
      let d: number[] | null = null;
      for (let i = 0; i < 5 && !d; i++) { d = await describeFace(videoRef.current); if (!d) await new Promise((r) => setTimeout(r, 400)); }
      if (!d) { setMsg("NO FACE — ENTER PIN"); faceTried.current = false; return; }
      const r = await window.cowork.faceLogin(d);
      if (r.ok) { setMsg("◈ IDENTITY CONFIRMED"); stopCam(); return onUnlock(); }
      setMsg("FACE NOT RECOGNIZED — ENTER PIN"); faceTried.current = false;
    } catch { setMsg("ENTER PIN"); faceTried.current = false; }
  }

  async function submitPin() {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      if (mode === "setpin") {
        if (!/^[0-9]{4,8}$/.test(pin)) { setErr("PIN must be 4–8 digits"); return; }
        if (pin !== pin2) { setErr("PINs don't match"); return; }
        const r = await window.cowork.pinSet(pin);
        if (r.ok) { stopCam(); return onUnlock(); }
        setErr("Could not set PIN");
      } else {
        const r = await window.cowork.pinVerify(pin);
        if (r.ok) { stopCam(); return onUnlock(); }
        setErr("Incorrect PIN"); setPin("");
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="lk">
      <style>{CSS}</style>
      <div className="lk-grid" />
      <div className="lk-card">
        {agent?.photo ? <img className="lk-photo" src={agent.photo} alt="" /> : <div className="lk-photo ph">◍</div>}
        <div className="lk-kick">{mode === "setpin" ? "SECURE THIS DEVICE" : "IDENTITY LOCK"}</div>
        <div className="lk-name">{agent?.displayName ?? "AGENT"}</div>
        {agent && <div className="lk-user">@{agent.username}</div>}

        {faceReady && mode === "pin" && (
          <div className="lk-cam"><video ref={videoRef} muted playsInline /><span className="lk-sweep" /></div>
        )}
        <div className="lk-msg">{mode === "setpin" ? "SET A 4–8 DIGIT UNLOCK PIN" : msg}</div>

        <input className="lk-pin" type="password" inputMode="numeric" value={pin} maxLength={8} autoFocus
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && submitPin()}
          placeholder={mode === "setpin" ? "NEW PIN" : "• • • •"} />
        {mode === "setpin" && (
          <input className="lk-pin" type="password" inputMode="numeric" value={pin2} maxLength={8}
            onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && submitPin()}
            placeholder="CONFIRM PIN" />
        )}
        <button className="lk-btn" onClick={submitPin} disabled={busy || pin.length < 4}>
          {busy ? "…" : mode === "setpin" ? "SET PIN & ENTER" : "UNLOCK"}
        </button>
        {err && <div className="lk-err">⚠ {err}</div>}
        <button className="lk-alt" onClick={() => { stopCam(); onSignOut(); }}>SIGN OUT (FULL LOGIN)</button>
      </div>
    </div>
  );
}

const CSS = `
.lk { position:fixed; inset:0; z-index:200; display:flex; align-items:center; justify-content:center; font-family:"SF Mono",ui-monospace,monospace;
  background: radial-gradient(ellipse 120% 90% at 50% 0%, #0a1620 0%, #050a10 55%, #030608 100%); }
.lk-grid { position:absolute; inset:0; opacity:.14; pointer-events:none;
  background-image: linear-gradient(rgb(84 230 255 / .25) 1px, transparent 1px), linear-gradient(90deg, rgb(84 230 255 / .25) 1px, transparent 1px);
  background-size: 44px 44px; -webkit-mask-image: radial-gradient(ellipse 80% 70% at 50% 45%, #000 30%, transparent 75%); mask-image: radial-gradient(ellipse 80% 70% at 50% 45%, #000 30%, transparent 75%); }
.lk-card { position:relative; z-index:2; width:340px; max-width:92vw; padding:26px 30px; border-radius:16px; text-align:center;
  border:1px solid rgb(84 230 255 / .3); background: rgb(8 14 20 / .78); backdrop-filter: blur(24px) saturate(1.3);
  box-shadow: 0 0 60px -18px rgb(84 230 255 / .5); display:flex; flex-direction:column; align-items:center; }
.lk-photo { width:88px; height:88px; border-radius:14px; object-fit:cover; border:2px solid rgb(84 230 255 / .55); box-shadow:0 0 20px -5px rgb(84 230 255 / .7); background:#05090d; }
.lk-photo.ph { display:flex; align-items:center; justify-content:center; font-size:40px; color: rgb(84 230 255 / .4); }
.lk-kick { font-size:9px; letter-spacing:.34em; color: rgb(84 230 255 / .85); margin-top:12px; font-weight:700; }
.lk-name { font-size:17px; font-weight:700; letter-spacing:.05em; color:#e6f2f4; margin-top:3px; }
.lk-user { font-size:10px; color: var(--text-faint, #6a7a80); letter-spacing:.14em; }
.lk-cam { position:relative; width:120px; height:120px; margin:14px 0 4px; border-radius:12px; overflow:hidden; border:1px solid rgb(84 230 255 / .45); background:#03080c; }
.lk-cam video { width:100%; height:100%; object-fit:cover; transform: scaleX(-1); }
.lk-sweep { position:absolute; left:6%; right:6%; height:2px; background: linear-gradient(90deg,transparent,rgb(84 230 255 / .95),transparent); box-shadow:0 0 16px 3px rgb(84 230 255 / .5); animation: lk-sweep 1.2s ease-in-out infinite alternate; }
@keyframes lk-sweep { 0% { top:8%; } 100% { top:88%; } }
.lk-msg { font-size:9.5px; letter-spacing:.2em; color: rgb(84 230 255 / .8); min-height:14px; margin:12px 0 10px; }
.lk-pin { width:100%; box-sizing:border-box; margin-bottom:9px; padding:11px 14px; border-radius:9px; text-align:center; letter-spacing:.4em; font-size:18px; font-family:inherit;
  border:1px solid rgb(84 230 255 / .3); background: rgb(84 230 255 / .05); color:#e6f2f4; outline:none; }
.lk-pin:focus { border-color: rgb(84 230 255 / .8); }
.lk-btn { width:100%; padding:12px 0; border-radius:9px; border:1px solid rgb(84 230 255 / .7); cursor:pointer; margin-top:3px;
  background: linear-gradient(180deg, rgb(84 230 255 / .22), rgb(84 230 255 / .1)); color:#d9f7ff; font-family:inherit; font-size:12px; font-weight:700; letter-spacing:.28em; }
.lk-btn:hover:not(:disabled) { box-shadow:0 0 26px -6px rgb(84 230 255 / .8); }
.lk-btn:disabled { opacity:.4; cursor:not-allowed; }
.lk-err { color:#ff7d72; font-size:11px; margin-top:10px; }
.lk-alt { background:none; border:none; color: rgb(230 242 244 / .35); font-family:inherit; font-size:9.5px; letter-spacing:.18em; cursor:pointer; margin-top:14px; }
.lk-alt:hover { color: rgb(84 230 255 / .8); }
`;
