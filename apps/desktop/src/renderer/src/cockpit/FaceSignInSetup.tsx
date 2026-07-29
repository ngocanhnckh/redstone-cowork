import { useCallback, useEffect, useRef, useState } from "react";
import { describeFace, loadFaceModels } from "../faceEngine";

/**
 * Face sign-in setup, done AFTER you're signed in.
 *
 * It used to live on the login screen, where it turned the camera on before a
 * first-time user had typed anything — asking for biometrics from someone who hasn't
 * even got an account yet. Enrolling is a preference, not a credential, so it belongs
 * here: sign in normally, then opt in if you want it.
 *
 * Per CLAUDE.md, every control reports its outcome inline next to itself; failures
 * stay until the next attempt.
 */

type Outcome = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "ok"; msg: string } | { kind: "err"; msg: string };

export default function FaceSignInSetup() {
  const [me, setMe] = useState<{ username: string; displayName: string; hasFace?: boolean } | null>(null);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "idle" });
  const [camOn, setCamOn] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const load = useCallback(async () => {
    try {
      const m = (await window.cowork.accountsMe()) as { username?: string | null; displayName?: string; hasFace?: boolean };
      if (m?.username) setMe({ username: m.username, displayName: m.displayName ?? m.username, hasFace: m.hasFace });
      else setMe(null);
    } catch {
      setMe(null);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const stopCam = useCallback(() => {
    try { streamRef.current?.getTracks().forEach((t) => t.stop()); } catch { /* already stopped */ }
    streamRef.current = null;
    setCamOn(false);
  }, []);

  // The camera must never outlive this panel — leaving it on after the modal closes
  // would keep the recording indicator lit with nothing on screen to explain it.
  useEffect(() => stopCam, [stopCam]);

  async function enroll() {
    if (!me) return;
    setOutcome({ kind: "busy", label: "Starting camera" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 480 } });
      streamRef.current = stream;
      setCamOn(true);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      setOutcome({ kind: "busy", label: "Loading models" });
      await loadFaceModels();

      setOutcome({ kind: "busy", label: "Look at the camera" });
      let descriptor: number[] | null = null;
      // Several attempts: the first frames are often still exposing.
      for (let i = 0; i < 12 && !descriptor; i++) {
        if (videoRef.current) descriptor = await describeFace(videoRef.current);
        if (!descriptor) await new Promise((r) => setTimeout(r, 350));
      }
      if (!descriptor) {
        setOutcome({ kind: "err", msg: "Couldn't find a face — try better lighting, then retry." });
        stopCam();
        return;
      }

      const r = await window.cowork.faceEnroll(descriptor, { username: me.username, displayName: me.displayName });
      if (!r.ok) { setOutcome({ kind: "err", msg: r.error ?? "Enrollment was rejected." }); stopCam(); return; }
      await window.cowork.deviceTrustEstablish().catch(() => {});
      stopCam();
      await load();
      setOutcome({ kind: "ok", msg: "Face sign-in is on for this device." });
      setTimeout(() => setOutcome({ kind: "idle" }), 2500);
    } catch (e) {
      stopCam();
      const msg = e instanceof Error ? e.message : String(e);
      setOutcome({
        kind: "err",
        msg: /permission|denied|NotAllowed/i.test(msg)
          ? "Camera access was denied — allow it in System Settings, then retry."
          : msg,
      });
    }
  }

  async function clearFace() {
    setOutcome({ kind: "busy", label: "Removing" });
    try {
      const r = await window.cowork.faceClearOwn();
      if (!r.ok) { setOutcome({ kind: "err", msg: "Could not remove it." }); return; }
      await load();
      setOutcome({ kind: "ok", msg: "Face sign-in removed." });
      setTimeout(() => setOutcome({ kind: "idle" }), 2500);
    } catch (e) {
      setOutcome({ kind: "err", msg: e instanceof Error ? e.message : "Could not remove it." });
    }
  }

  // Only meaningful for an account-based sign-in; there's nobody to enroll otherwise.
  if (!me) return null;

  const busy = outcome.kind === "busy";
  const color = outcome.kind === "err" ? "rgb(230 99 86)" : outcome.kind === "ok" ? "rgb(126 200 140)" : "var(--text-soft)";

  return (
    <div style={{ marginTop: 26, paddingTop: 22, borderTop: "1px solid var(--border)" }}>
      <span className="kicker">Sign-in</span>
      <h2 className="display" style={{ fontSize: 20, margin: "2px 0 10px" }}>Face sign-in</h2>
      <p className="faint" style={{ fontSize: 11.5, margin: "0 2px 14px", lineHeight: 1.55 }}>
        Unlock this device with your face instead of retyping your password. Optional — your
        password always works. The scan happens on this machine.
      </p>

      {camOn && (
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 12 }}>
          <video
            ref={videoRef}
            muted
            playsInline
            style={{ width: 132, height: 132, borderRadius: "50%", objectFit: "cover", border: "1px solid var(--border-strong)" }}
          />
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={() => void enroll()}
          disabled={busy}
          style={{
            padding: "8px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 9, cursor: busy ? "default" : "pointer",
            border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text)",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {me.hasFace ? "Re-scan my face" : "Set up face sign-in"}
        </button>
        {me.hasFace && (
          <button
            onClick={() => void clearFace()}
            disabled={busy}
            style={{
              padding: "8px 12px", fontSize: 12.5, borderRadius: 9, cursor: busy ? "default" : "pointer",
              border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)",
              opacity: busy ? 0.6 : 1,
            }}
          >
            Remove
          </button>
        )}
        <span style={{ flex: 1 }} />
        {me.hasFace && outcome.kind === "idle" && (
          <span className="faint" style={{ fontSize: 11, fontFamily: "var(--font-mono)" }}>enrolled</span>
        )}
      </div>

      {outcome.kind !== "idle" && (
        <div style={{ fontSize: 11.5, color, margin: "8px 2px 0", lineHeight: 1.45, fontFamily: "var(--font-mono)" }}>
          {outcome.kind === "busy" ? `${outcome.label}…` : outcome.msg}
        </div>
      )}
    </div>
  );
}
