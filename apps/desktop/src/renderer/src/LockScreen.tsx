import { useCallback, useEffect, useRef, useState } from "react";
import { describeFace, loadFaceModels } from "./faceEngine";

// Quick-unlock lock screen shown on app launch / after the away-timeout when an
// agent session is stored. The session token stays put — this just re-verifies the
// person. When this device is face-enrolled we SCAN FIRST: the agent's identity is
// hidden until the camera recognises them ("◈ AGENT IDENTIFIED"), then it unlocks —
// no PIN needed. PIN is the fallback (and first-time setup when there's neither).

interface Props {
  onUnlock: () => void;
  onSignOut: () => void;
}
type Agent = { displayName: string; username: string; photo: string | null; hasPin: boolean };
// scanning → face camera up, identity concealed; identified → recognised, revealing;
// pin → enter PIN; setpin → first-time PIN setup.
type Phase = "scanning" | "identified" | "pin" | "setpin";

export default function LockScreen({ onUnlock, onSignOut }: Props) {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [faceReady, setFaceReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("pin");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("IDENTIFY YOURSELF");
  const [err, setErr] = useState("");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCam = useCallback(() => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; }, []);

  // Load identity + whether face unlock is available on this device. When the device
  // is enrolled we OPEN in scan mode (identity concealed until recognised).
  useEffect(() => {
    (async () => {
      try {
        const me = await window.cowork.accountsMe();
        let trust = await window.cowork.deviceTrust().catch(() => null);
        if (me && "username" in me && me.username) {
          const a = me as { displayName: string; username: string; photo?: string | null; hasPin?: boolean; hasFace?: boolean };
          const ag: Agent = { displayName: a.displayName || a.username, username: a.username, photo: a.photo ?? null, hasPin: !!a.hasPin };
          setAgent(ag);
          // If the account has an enrolled face (e.g. one an admin added from the roster
          // photo) but this device isn't trusted yet, trust it now — we're already in an
          // authenticated session — so face unlock becomes available without a re-login.
          if (!trust && a.hasFace) {
            const r = await window.cowork.deviceTrustEstablish().catch(() => ({ ok: false }));
            if (r.ok) trust = await window.cowork.deviceTrust().catch(() => null);
          }
          setFaceReady(!!trust);
          if (trust) { setPhase("scanning"); setMsg("LOOK AT THE CAMERA"); }
          else if (!ag.hasPin) { setPhase("setpin"); setMsg("SET A 4–8 DIGIT UNLOCK PIN"); }
          else { setPhase("pin"); setMsg("ENTER YOUR PIN"); }
        }
      } catch { /* fall back to sign out */ }
    })();
  }, []);

  // Face-scan loop — runs continuously while scanning, re-attempting until it matches
  // (or the agent switches to PIN). A single failed frame never gives up.
  useEffect(() => {
    if (phase !== "scanning" || !faceReady) return;
    let alive = true;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 480 }, audio: false });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => {}); }
        await loadFaceModels();
        await sleep(1200); // let the camera warm up / autoexpose
        let attempts = 0;
        while (alive) {
          const d = videoRef.current ? await describeFace(videoRef.current) : null;
          if (!alive) break;
          if (!d) { setMsg("NO FACE DETECTED — HOLD STILL…"); await sleep(650); continue; }
          setMsg("MATCHING BIOMETRIC SIGNATURE…");
          const r = await window.cowork.faceLogin(d);
          if (!alive) break;
          if (r.ok) {
            // Boom — identified. Reveal the agent, then unlock after a short flourish.
            if (r.account) setAgent((prev) => prev ?? { displayName: r.account!.displayName, username: r.account!.username, photo: null, hasPin: false });
            setPhase("identified"); setMsg("◈ AGENT IDENTIFIED");
            stopCam();
            // NB: no `alive` guard here — setPhase re-runs this effect and its cleanup
            // sets alive=false, which would otherwise cancel the unlock. We matched; go.
            setTimeout(() => onUnlock(), 1100);
            return;
          }
          attempts++;
          setMsg(attempts >= 4 ? "STILL SCANNING… OR USE PIN" : "REALIGNING — LOOK STRAIGHT AT THE CAMERA…");
          await sleep(900);
        }
      } catch { if (alive) { setMsg("CAMERA UNAVAILABLE — USE PIN"); toPin(); } }
    })();
    return () => { alive = false; stopCam(); };
  }, [phase, faceReady]); // eslint-disable-line

  function toPin() {
    stopCam();
    setPhase(agent && !agent.hasPin && !faceReady ? "setpin" : "pin");
    setMsg(agent && !agent.hasPin ? "SET A 4–8 DIGIT UNLOCK PIN" : "ENTER YOUR PIN");
  }
  function toScan() { setErr(""); setPin(""); setPhase("scanning"); setMsg("LOOK AT THE CAMERA"); }

  async function submitPin() {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      if (phase === "setpin") {
        if (!/^[0-9]{4,8}$/.test(pin)) { setErr("PIN must be 4–8 digits"); return; }
        if (pin !== pin2) { setErr("PINs don't match"); return; }
        const r = await window.cowork.pinSet(pin);
        if (r.ok) { stopCam(); return onUnlock(); }
        setErr("Could not set PIN");
      } else {
        const r = await window.cowork.pinVerify(pin);
        if (r.ok) { setPhase("identified"); setMsg("◈ ACCESS GRANTED"); stopCam(); setTimeout(() => onUnlock(), 700); return; }
        setErr("Incorrect PIN"); setPin("");
      }
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const scanning = phase === "scanning";
  const identified = phase === "identified";
  const concealed = scanning; // hide identity until recognised
  const isPin = phase === "pin" || phase === "setpin";

  return (
    <div className="lk">
      <style>{CSS}</style>
      <div className="lk-grid" />
      <div className="lk-card">
        {/* Identity block — concealed while scanning, revealed on identification. */}
        {concealed ? (
          <div className="lk-photo ph unknown">◍</div>
        ) : agent?.photo ? (
          <img className={`lk-photo${identified ? " reveal" : ""}`} src={agent.photo} alt="" />
        ) : (
          <div className={`lk-photo ph${identified ? " reveal" : ""}`}>◍</div>
        )}
        <div className="lk-kick">
          {phase === "setpin" ? "SECURE THIS DEVICE" : identified ? "IDENTITY CONFIRMED" : scanning ? "◍ UNIDENTIFIED" : "IDENTITY LOCK"}
        </div>
        <div className="lk-name">{concealed ? "SCANNING…" : agent?.displayName ?? "AGENT"}</div>
        {!concealed && agent && <div className="lk-user">@{agent.username}</div>}

        {(scanning || identified) && faceReady && (
          <div className={`lk-cam${identified ? " ok" : ""}`}>
            <video ref={videoRef} muted playsInline />
            {scanning && <span className="lk-sweep" />}
            {identified && <span className="lk-check">◈</span>}
          </div>
        )}
        <div className="lk-msg">{msg}</div>

        {isPin && (
          <>
            <input className="lk-pin" type="password" inputMode="numeric" value={pin} maxLength={8} autoFocus
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && submitPin()}
              placeholder={phase === "setpin" ? "NEW PIN" : "• • • •"} />
            {phase === "setpin" && (
              <input className="lk-pin" type="password" inputMode="numeric" value={pin2} maxLength={8}
                onChange={(e) => setPin2(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && submitPin()}
                placeholder="CONFIRM PIN" />
            )}
            <button className="lk-btn" onClick={submitPin} disabled={busy || pin.length < 4}>
              {busy ? "…" : phase === "setpin" ? "SET PIN & ENTER" : "UNLOCK"}
            </button>
          </>
        )}

        {err && <div className="lk-err">⚠ {err}</div>}

        {/* Method switch: offer the other route when both are available. */}
        {scanning && (agent?.hasPin || !faceReady) && (
          <button className="lk-alt" onClick={toPin}>USE PIN INSTEAD</button>
        )}
        {phase === "pin" && faceReady && (
          <button className="lk-alt" onClick={toScan}>◈ SCAN FACE</button>
        )}
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
.lk-photo.ph.unknown { color: rgb(84 230 255 / .25); border-color: rgb(84 230 255 / .25); box-shadow:none; animation: lk-pulse 1.6s ease-in-out infinite; }
.lk-photo.reveal { animation: lk-reveal .5s cubic-bezier(.2,.9,.3,1.2) both; border-color: rgb(120 255 190 / .85); box-shadow:0 0 26px -4px rgb(120 255 190 / .7); }
@keyframes lk-reveal { 0% { opacity:0; transform: scale(.6) rotate(-6deg); filter:brightness(2); } 100% { opacity:1; transform:none; filter:none; } }
@keyframes lk-pulse { 0%,100% { opacity:.5; } 50% { opacity:1; } }
.lk-kick { font-size:9px; letter-spacing:.34em; color: rgb(84 230 255 / .85); margin-top:12px; font-weight:700; }
.lk-name { font-size:17px; font-weight:700; letter-spacing:.05em; color:#e6f2f4; margin-top:3px; }
.lk-user { font-size:10px; color: var(--text-faint, #6a7a80); letter-spacing:.14em; }
.lk-cam { position:relative; width:120px; height:120px; margin:14px 0 4px; border-radius:12px; overflow:hidden; border:1px solid rgb(84 230 255 / .45); background:#03080c; }
.lk-cam.ok { border-color: rgb(120 255 190 / .8); box-shadow:0 0 22px -4px rgb(120 255 190 / .7); }
.lk-cam video { width:100%; height:100%; object-fit:cover; transform: scaleX(-1); }
.lk-sweep { position:absolute; left:6%; right:6%; height:2px; background: linear-gradient(90deg,transparent,rgb(84 230 255 / .95),transparent); box-shadow:0 0 16px 3px rgb(84 230 255 / .5); animation: lk-sweep 1.2s ease-in-out infinite alternate; }
@keyframes lk-sweep { 0% { top:8%; } 100% { top:88%; } }
.lk-check { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:44px; color: rgb(120 255 190 / .95); text-shadow:0 0 18px rgb(120 255 190 / .8); animation: lk-reveal .45s ease both; }
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
