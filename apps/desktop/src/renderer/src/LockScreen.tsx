import { useCallback, useEffect, useRef, useState } from "react";
import { describeFaceWithBox, loadFaceModels, type FaceBox } from "./faceEngine";
import AgentIdentScan from "./cockpit/AgentIdentScan";

/** Crop a square face snapshot (data URL) from the current video frame, centred on the
 *  detected box with a little headroom — shown as the "live capture" in the ident sequence. */
function snapFace(video: HTMLVideoElement, box: FaceBox): string {
  const vw = video.videoWidth || 480, vh = video.videoHeight || 480;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const side = Math.min(vw, vh, Math.max(box.width, box.height) * 1.85);
  let sx = cx - side / 2, sy = cy - side / 2 - box.height * 0.08; // bias up for headroom
  sx = Math.max(0, Math.min(vw - side, sx));
  sy = Math.max(0, Math.min(vh - side, sy));
  const c = document.createElement("canvas"); c.width = 300; c.height = 300;
  const ctx = c.getContext("2d"); if (!ctx) return "";
  ctx.drawImage(video, sx, sy, side, side, 0, 0, 300, 300);
  return c.toDataURL("image/jpeg", 0.86);
}

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
  // The just-captured live face (data URL). When set, the movie-style identification
  // sequence (capture on the left, database roll on the right → MATCH) plays, then unlocks.
  const [scan, setScan] = useState<string | null>(null);
  // Roster faces the identification roll spins through. Seeded from a local cache so it
  // still animates even when the session token has idle-expired (accountsList would 401).
  const [roster, setRoster] = useState<Array<{ photo: string | null; username: string }>>(() => {
    try { return JSON.parse(localStorage.getItem("rcw.roster") || "[]"); } catch { return []; }
  });
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCam = useCallback(() => { streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; }, []);

  // Load identity + whether face unlock is available on this device. When the device
  // is enrolled we OPEN in scan mode (identity concealed until recognised).
  useEffect(() => {
    (async () => {
      // Device trust is LOCAL and works even when the session token has idle-expired —
      // face sign-in uses the device secret, not the token. So decide face availability
      // from trust FIRST, and only use accountsMe (which can 401 on an expired token) to
      // enrich the displayed identity. Never let a failed accountsMe hide face unlock.
      let trust = await window.cowork.deviceTrust().catch(() => null);
      const me = await window.cowork.accountsMe().catch(() => null);
      const acct = me && "username" in me && me.username
        ? (me as { displayName: string; username: string; photo?: string | null; hasPin?: boolean; hasFace?: boolean })
        : null;

      // If the account has an enrolled face but this device isn't trusted yet, trust it
      // now (only possible while the token is still valid).
      if (!trust && acct?.hasFace) {
        const r = await window.cowork.deviceTrustEstablish().catch(() => ({ ok: false }));
        if (r.ok) trust = await window.cowork.deviceTrust().catch(() => null);
      }

      // Identity for the reveal — from the account if available, else the trust record
      // (which carries username/displayName/photo), else a neutral placeholder.
      const ag: Agent = acct
        ? { displayName: acct.displayName || acct.username, username: acct.username, photo: acct.photo ?? null, hasPin: !!acct.hasPin }
        : trust
          ? { displayName: trust.displayName || trust.username, username: trust.username, photo: trust.photo, hasPin: true }
          : { displayName: "AGENT", username: "", photo: null, hasPin: true };
      setAgent(ag);

      // Roster faces for the identification roll (best-effort; cached for expired-token runs).
      window.cowork.accountsList().then((rows) => {
        const list = (rows || []).map((r) => ({ photo: r.photo ?? null, username: r.username }));
        if (list.length) { setRoster(list); try { localStorage.setItem("rcw.roster", JSON.stringify(list.filter((x) => x.photo).slice(0, 40))); } catch { /* ignore */ } }
      }).catch(() => { /* not admin / token expired — the cached roster still rolls */ });

      setFaceReady(!!trust);
      if (trust) { setPhase("scanning"); setMsg("LOOK AT THE CAMERA"); }
      else if (acct && !acct.hasPin) { setPhase("setpin"); setMsg("SET A 4–8 DIGIT UNLOCK PIN"); }
      else { setPhase("pin"); setMsg("ENTER YOUR PIN"); }
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
          const det = videoRef.current ? await describeFaceWithBox(videoRef.current) : null;
          if (!alive) break;
          if (!det) { setMsg("NO FACE DETECTED — HOLD STILL…"); await sleep(650); continue; }
          setMsg("MATCHING BIOMETRIC SIGNATURE…");
          const r = await window.cowork.faceLogin(det.descriptor);
          if (!alive) break;
          if (r.ok) {
            // Boom — identified. Freeze a face snapshot from THIS frame, then hand off to the
            // movie-style identification sequence which unlocks when it finishes.
            if (r.account) setAgent((prev) => prev ?? { displayName: r.account!.displayName, username: r.account!.username, photo: null, hasPin: false });
            const snap = videoRef.current ? snapFace(videoRef.current, det.box) : "";
            setPhase("identified"); setMsg("◈ AGENT IDENTIFIED");
            stopCam();
            // NB: no `alive` guard — the identification overlay owns the unlock via onDone.
            setScan(snap || "pending");
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
            {scanning && (
              <>
                {/* targeting reticle + face guide — the "align your face" movie frame */}
                <span className="lk-ret tl" /><span className="lk-ret tr" />
                <span className="lk-ret bl" /><span className="lk-ret br" />
                <span className="lk-guide" />
                <span className="lk-grid2" />
              </>
            )}
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

      {/* Movie-style identification sequence: live capture compared against the on-file
          photo, biometrics tick to 100%, MATCH locks, then it unlocks. */}
      {scan && (
        <AgentIdentScan
          captured={scan === "pending" ? null : scan}
          subject={{
            photo: agent?.photo ?? roster.find((r) => r.username === agent?.username)?.photo ?? null,
            name: agent?.displayName ?? "AGENT",
            username: agent?.username ?? "",
          }}
          candidates={roster}
          onDone={onUnlock}
        />
      )}
    </div>
  );
}

const CSS = `
.lk { position:fixed; inset:0; z-index:200; display:flex; align-items:center; justify-content:center; font-family:"SF Mono",ui-monospace,monospace;
  background: radial-gradient(ellipse 120% 90% at 50% 0%, #0a1620 0%, #050a10 55%, #030608 100%); }
.lk-grid { position:absolute; inset:0; opacity:.14; pointer-events:none;
  background-image: linear-gradient(rgba(232,230,225,.25) 1px, transparent 1px), linear-gradient(90deg, rgba(232,230,225,.25) 1px, transparent 1px);
  background-size: 44px 44px; -webkit-mask-image: radial-gradient(ellipse 80% 70% at 50% 45%, #000 30%, transparent 75%); mask-image: radial-gradient(ellipse 80% 70% at 50% 45%, #000 30%, transparent 75%); }
.lk-card { position:relative; z-index:2; width:340px; max-width:92vw; padding:26px 30px; border-radius:16px; text-align:center;
  border:1px solid rgba(232,230,225,.3); background: rgb(8 14 20 / .78); backdrop-filter: blur(24px) saturate(1.3);
  display:flex; flex-direction:column; align-items:center; }
.lk-photo { width:88px; height:88px; border-radius:14px; object-fit:cover; border:2px solid rgba(232,230,225,.55); background:#0a0a0a; }
.lk-photo.ph { display:flex; align-items:center; justify-content:center; font-size:40px; color: var(--text-faint); }
.lk-photo.ph.unknown { color: rgba(232,230,225,.25); border-color: rgba(232,230,225,.25); box-shadow:none; }
.lk-photo.reveal { animation: lk-reveal .5s cubic-bezier(.2,.9,.3,1.2) both; border-color: rgba(232,230,225,.85); }
@keyframes lk-reveal { 0% { opacity:0; transform: scale(.6) rotate(-6deg); filter:brightness(2); } 100% { opacity:1; transform:none; filter:none; } }
.lk-kick { font-size:9px; letter-spacing:.34em; color: var(--text-soft); margin-top:12px; font-weight:700; }
.lk-name { font-size:17px; font-weight:700; letter-spacing:.05em; color:var(--text); margin-top:3px; }
.lk-user { font-size:10px; color: var(--text-faint); letter-spacing:.14em; }
.lk-cam { position:relative; width:212px; height:212px; margin:16px 0 4px; border-radius:14px; overflow:hidden; border:1px solid rgba(232,230,225,.45); background:#0a0a0a;
  box-shadow: inset 0 0 40px rgb(0 0 0 / .6), 0 8px 30px rgb(0 0 0 / .5); }
.lk-cam.ok { border-color: rgba(232,230,225,.8); }
.lk-cam video { width:100%; height:100%; object-fit:cover; transform: scaleX(-1); }
.lk-sweep { position:absolute; left:5%; right:5%; height:2px; background: linear-gradient(90deg, transparent, rgba(232,230,225,.95) 20%, rgba(230,59,46,.95) 50%, rgba(232,230,225,.95) 80%, transparent);
  box-shadow: 0 0 12px rgba(230,59,46,.5); animation: lk-sweep 1.5s ease-in-out infinite alternate; }
@keyframes lk-sweep { 0% { top:7%; } 100% { top:89%; } }
/* targeting reticle corners */
.lk-ret { position:absolute; width:22px; height:22px; border-color: rgba(230,59,46,.85); pointer-events:none; }
.lk-ret.tl { top:9px; left:9px; border-top:2px solid; border-left:2px solid; }
.lk-ret.tr { top:9px; right:9px; border-top:2px solid; border-right:2px solid; }
.lk-ret.bl { bottom:9px; left:9px; border-bottom:2px solid; border-left:2px solid; }
.lk-ret.br { bottom:9px; right:9px; border-bottom:2px solid; border-right:2px solid; }
/* dashed oval face-alignment guide, gently breathing */
.lk-guide { position:absolute; left:50%; top:48%; width:58%; height:74%; transform:translate(-50%,-50%); border-radius:50%;
  border:1.5px dashed rgba(232,230,225,.42); animation: lk-guide 2.6s ease-in-out infinite; pointer-events:none; }
@keyframes lk-guide { 0%,100% { opacity:.42; } 50% { opacity:.85; } }
.lk-grid2 { position:absolute; inset:0; pointer-events:none; opacity:.5;
  background-image: linear-gradient(rgba(230,59,46,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(230,59,46,.08) 1px, transparent 1px);
  background-size: 22px 22px; }
.lk-check { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:44px; color: var(--text); animation: lk-reveal .45s ease both; }
.lk-msg { font-size:9.5px; letter-spacing:.2em; color: var(--text-soft); min-height:14px; margin:12px 0 10px; }
.lk-pin { width:100%; box-sizing:border-box; margin-bottom:9px; padding:11px 14px; border-radius:9px; text-align:center; letter-spacing:.4em; font-size:18px; font-family:inherit;
  border:1px solid rgba(232,230,225,.3); background: rgba(232,230,225,.05); color:var(--text); outline:none; }
.lk-pin:focus { border-color: rgba(232,230,225,.8); }
.lk-btn { width:100%; padding:12px 0; border-radius:9px; border:1px solid var(--text); cursor:pointer; margin-top:3px;
  background: var(--text); color:#0a0a0a; font-family:inherit; font-size:12px; font-weight:700; letter-spacing:.28em; }
.lk-btn:hover:not(:disabled) { background:#e63b2e; border-color:#e63b2e; }
.lk-btn:disabled { opacity:.4; cursor:not-allowed; }
.lk-err { color:#e63b2e; font-size:11px; margin-top:10px; }
.lk-alt { background:none; border:none; color: var(--text-faint); font-family:inherit; font-size:9.5px; letter-spacing:.18em; cursor:pointer; margin-top:14px; }
.lk-alt:hover { color: var(--text); }
`;
