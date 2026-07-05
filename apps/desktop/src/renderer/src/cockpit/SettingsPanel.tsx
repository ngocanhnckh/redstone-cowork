import { useEffect, useState } from "react";
import { useStore } from "../store";
import AccessKeysManager from "./AccessKeysManager";
import {
  type Appearance,
  loadAppearance,
  saveAppearance,
  applyAppearance,
  applyBgImage,
  DOCK_POSITIONS,
  DOCK_LABEL,
} from "../appearance";

/**
 * Connection settings — reachable any time from the title bar. Lets the user see
 * which cowork server the app points at, change the server URL / access token,
 * reconnect, or sign out. (First-run uses the standalone Login screen; this is
 * the same config, editable after connecting.)
 */
export default function SettingsPanel() {
  const open = useStore((s) => s.settingsOpen);
  const toggle = useStore((s) => s.toggleSettings);

  const [serverUrl, setServerUrl] = useState("");
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<"token" | "redstone">("token");
  const [redstoneOn, setRedstoneOn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "ok" | "err"; text?: string }>({ kind: "idle" });

  // Appearance prefs (client-side, applied live). Background image + fullscreen
  // state live in the main process; we mirror their presence here.
  const [appr, setAppr] = useState<Appearance>(loadAppearance);
  const [hasBg, setHasBg] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const [hasVideo, setHasVideo] = useState(false);
  const [videoBusy, setVideoBusy] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const patchAppr = (p: Partial<Appearance>) => {
    setAppr((cur) => { const next = { ...cur, ...p }; saveAppearance(next); applyAppearance(next); return next; });
  };
  const chooseBg = async () => {
    setBgBusy(true);
    try {
      const r = await window.cowork.chooseBgImage();
      if (r.ok && r.dataUrl) {
        applyBgImage(r.dataUrl); setHasBg(true);
        // image + video are mutually exclusive backdrops
        await window.cowork.clearBgVideo().catch(() => {});
        setHasVideo(false); window.dispatchEvent(new Event("rcw-bgvideo"));
      } else if (r.error) setStatus({ kind: "err", text: r.error });
    } finally { setBgBusy(false); }
  };
  const removeBg = async () => {
    await window.cowork.clearBgImage().catch(() => {});
    applyBgImage(null);
    setHasBg(false);
  };
  const chooseVideo = async () => {
    setVideoBusy(true);
    try {
      const r = await window.cowork.chooseBgVideo();
      if (r.ok) {
        setHasVideo(true); window.dispatchEvent(new Event("rcw-bgvideo"));
        // image + video are mutually exclusive backdrops
        await window.cowork.clearBgImage().catch(() => {});
        applyBgImage(null); setHasBg(false);
      } else if (r.error) setStatus({ kind: "err", text: r.error });
    } finally { setVideoBusy(false); }
  };
  const removeVideo = async () => {
    await window.cowork.clearBgVideo().catch(() => {});
    setHasVideo(false);
    window.dispatchEvent(new Event("rcw-bgvideo"));
  };
  const toggleFullscreen = async () => {
    try { const r = await window.cowork.setSimpleFullscreen(!fullscreen); setFullscreen(r.fullscreen); } catch { /* ignore */ }
  };

  // Load the current server URL each time the panel opens (tokens are never read
  // back). Remember whether the current session is org (Redstone) and ask the
  // server whether it offers Redstone sign-in, so we can show the right controls.
  useEffect(() => {
    if (!open) return;
    setStatus({ kind: "idle" });
    setToken(""); setPassword(""); setUsername("");
    window.cowork.getConfig().then((cfg) => {
      const url = cfg?.serverUrl ?? "https://cowork.example.com";
      setServerUrl(url);
      setMode(cfg?.isOrg ? "redstone" : "token");
      window.cowork.authConfig(url).then((c) => setRedstoneOn(!!c.redstone)).catch(() => {});
    });
    setAppr(loadAppearance());
    window.cowork.getBgImage().then((u) => setHasBg(!!u)).catch(() => {});
    window.cowork.getBgVideo().then((u) => setHasVideo(!!u)).catch(() => {});
    window.cowork.getFullscreenState().then((s) => setFullscreen(s.fullscreen)).catch(() => {});
  }, [open]);

  if (!open) return null;

  async function saveAndReconnect() {
    const url = serverUrl.trim();
    if (!url) { setStatus({ kind: "err", text: "server URL is required" }); return; }
    setStatus({ kind: "saving" });
    try {
      if (mode === "redstone") {
        if (!username.trim() || !password) { setStatus({ kind: "err", text: "enter your Redstone username and password" }); return; }
        const r = await window.cowork.redstoneLogin(url, username.trim(), password);
        if (!r.ok) { setStatus({ kind: "err", text: r.error ?? "Redstone sign-in failed" }); return; }
      } else {
        if (!token.trim()) { setStatus({ kind: "err", text: "enter the access token to reconnect" }); return; }
        await window.cowork.saveConfig(url, token.trim());
      }
      setStatus({ kind: "ok", text: "saved — reconnecting…" });
      setTimeout(() => window.location.reload(), 500);
    } catch (e) {
      setStatus({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    }
  }

  async function signOut() {
    await window.cowork.clearConfig();
    window.location.reload(); // App re-gates → Login screen
  }

  return (
    <div
      onClick={toggle}
      style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        className="glass-soft no-scrollbar"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 440, maxWidth: "92vw", maxHeight: "88vh", overflowY: "auto", borderRadius: 18, border: "1px solid var(--border-strong)", padding: "26px 28px" }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 4 }}>
          <span className="kicker">Connection</span>
          <span style={{ flex: 1 }} />
          <button onClick={toggle} title="Close" style={iconBtn}>✕</button>
        </div>
        <h2 className="display" style={{ fontSize: 24, margin: "0 0 18px" }}>Cowork server</h2>

        <label className="soft" style={labelStyle}>Server URL / hostname</label>
        <input
          type="url"
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder="https://cowork.example.com  or  http://192.168.1.10:47101"
          style={inputStyle}
        />
        <p className="faint" style={{ fontSize: 11, margin: "6px 2px 16px", lineHeight: 1.5 }}>
          The domain or IP:port where your cowork server is reachable. The app calls this for everything.
        </p>

        {redstoneOn && (
          <div style={{ display: "flex", gap: 6, padding: 4, marginBottom: 16, border: "1px solid var(--border)", borderRadius: 11 }}>
            {(["redstone", "token"] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setStatus({ kind: "idle" }); }}
                style={{
                  flex: 1, padding: "7px 0", fontSize: 12.5, fontWeight: 600, textAlign: "center", cursor: "pointer",
                  borderRadius: 8, border: 0,
                  background: mode === m ? "rgb(var(--primary) / 0.28)" : "transparent",
                  color: mode === m ? "#fff" : "var(--text-soft)",
                }}
              >
                {m === "redstone" ? "Organization" : "Personal"}
              </button>
            ))}
          </div>
        )}

        {mode === "redstone" && redstoneOn ? (
          <>
            <label className="soft" style={labelStyle}>Redstone username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@yourorg" autoCapitalize="off" autoCorrect="off" spellCheck={false} style={{ ...inputStyle, marginBottom: 12 }} />
            <label className="soft" style={labelStyle}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your Redstone password" autoComplete="current-password" style={inputStyle} />
            <p className="faint" style={{ fontSize: 11, margin: "6px 2px 20px", lineHeight: 1.5 }}>
              Sign in with your organization&apos;s Redstone account. The password is exchanged for a token server-side and never stored here.
            </p>
          </>
        ) : (
          <>
            <label className="soft" style={labelStyle}>Access token</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Your INSTANCE_TOKEN (paste to change / reconnect)"
              style={inputStyle}
            />
            <p className="faint" style={{ fontSize: 11, margin: "6px 2px 20px", lineHeight: 1.5 }}>
              The instance token from the server's <span className="mono">.env</span> — this is how the app authenticates.
            </p>
          </>
        )}

        {status.kind !== "idle" && (
          <div className="mono" style={{ fontSize: 11.5, marginBottom: 12, color: status.kind === "err" ? "#e0736a" : "rgb(var(--accent))" }}>
            {status.kind === "saving" ? "saving…" : status.text}
          </div>
        )}

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button onClick={saveAndReconnect} className="glass-btn--clay" style={{ padding: "11px 20px", fontSize: 14, fontWeight: 600 }}>
            Save & reconnect
          </button>
          <span style={{ flex: 1 }} />
          <button onClick={signOut} style={{ ...iconBtn, width: "auto", padding: "8px 16px", borderRadius: 999, fontSize: 12.5, color: "#e0736a", borderColor: "rgba(224,115,106,0.4)" }}>
            Sign out
          </button>
        </div>

        <div style={{ height: 1, background: "var(--border)", margin: "24px 0 18px" }} />

        {/* ---- Appearance ---- */}
        <span className="kicker">Appearance</span>
        <h2 className="display" style={{ fontSize: 22, margin: "2px 0 16px" }}>Look &amp; feel</h2>

        <SwitchRow
          label="Background animation"
          hint="The drifting aurora glow behind the app."
          on={appr.bgAnim}
          onToggle={() => patchAppr({ bgAnim: !appr.bgAnim })}
        />

        <SliderRow
          label="App tint"
          hint="Opacity of the app over the wallpaper — lower = more transparent / more wallpaper shows through."
          value={appr.veil}
          min={0}
          max={20}
          suffix="%"
          onChange={(v) => patchAppr({ veil: v })}
        />

        <SliderRow
          label="Blur"
          hint="Frosted-glass blur of the app surface (and any background image)."
          value={appr.blur}
          min={0}
          max={60}
          suffix="px"
          onChange={(v) => patchAppr({ blur: v })}
        />

        <SliderRow
          label="Glass"
          hint="How solid the HUD window & panel glass is — lower = more see-through / brighter, higher = more opaque."
          value={appr.glass}
          min={55}
          max={100}
          suffix="%"
          onChange={(v) => patchAppr({ glass: v })}
        />

        <label className="soft" style={{ ...labelStyle, marginTop: 18 }}>Dock position</label>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 16 }}>
          {DOCK_POSITIONS.map((pos) => (
            <button
              key={pos}
              onClick={() => patchAppr({ dockPos: pos })}
              style={{
                padding: "8px 4px", fontSize: 11, fontWeight: 600, cursor: "pointer", borderRadius: 9,
                border: appr.dockPos === pos ? "1px solid rgb(var(--accent) / 0.6)" : "1px solid var(--border)",
                background: appr.dockPos === pos ? "rgb(var(--primary) / 0.28)" : "transparent",
                color: appr.dockPos === pos ? "#fff" : "var(--text-soft)",
              }}
            >
              {DOCK_LABEL[pos]}
            </button>
          ))}
        </div>

        <SliderRow
          label="Dock size"
          hint="Size of the HUD dock (Windows mode)."
          value={Math.round(appr.dockScale * 100)}
          min={60}
          max={160}
          suffix="%"
          onChange={(v) => patchAppr({ dockScale: v / 100 })}
        />

        <SwitchRow
          label="Transparent app in HUD mode"
          hint="In HUD mode, make the app shell fully see-through to the desktop. Each widget keeps its own glass so content stays readable."
          on={appr.hudClear}
          onToggle={() => patchAppr({ hudClear: !appr.hudClear })}
        />

        <label className="soft" style={labelStyle}>Background image</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
          <button onClick={chooseBg} disabled={bgBusy} className="glass-btn--clay" style={{ padding: "9px 16px", fontSize: 13, fontWeight: 600 }}>
            {bgBusy ? "…" : hasBg ? "Replace image…" : "Choose image…"}
          </button>
          {hasBg && (
            <button onClick={removeBg} style={{ ...iconBtn, width: "auto", padding: "8px 14px", borderRadius: 999, fontSize: 12.5 }}>
              Remove
            </button>
          )}
          <span className="faint mono" style={{ fontSize: 11 }}>{hasBg ? "✓ image set" : "using desktop wallpaper"}</span>
        </div>
        <p className="faint" style={{ fontSize: 11, margin: "0 2px 18px", lineHeight: 1.5 }}>
          Shown blurred &amp; tinted behind the app (max 12&nbsp;MB). Leave empty for the transparent, see-through desktop look.
        </p>

        <label className="soft" style={labelStyle}>Background video</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
          <button onClick={chooseVideo} disabled={videoBusy} className="glass-btn--clay" style={{ padding: "9px 16px", fontSize: 13, fontWeight: 600 }}>
            {videoBusy ? "…" : hasVideo ? "Replace video…" : "Choose video…"}
          </button>
          {hasVideo && (
            <button onClick={removeVideo} style={{ ...iconBtn, width: "auto", padding: "8px 14px", borderRadius: 999, fontSize: 12.5 }}>
              Remove
            </button>
          )}
          <span className="faint mono" style={{ fontSize: 11 }}>{hasVideo ? "✓ looping" : "off"}</span>
        </div>
        <SwitchRow
          label="Mute video"
          hint="The background video loops with sound by default; mute it here."
          on={appr.videoMuted}
          onToggle={() => patchAppr({ videoMuted: !appr.videoMuted })}
        />
        <p className="faint" style={{ fontSize: 11, margin: "0 2px 18px", lineHeight: 1.5 }}>
          Plays on a loop behind the app (with audio) as a live wallpaper — great in fullscreen / transparent HUD mode. Takes precedence over a background image.
        </p>

        <SwitchRow
          label="Keep wallpaper in fullscreen"
          hint="macOS native fullscreen hides the desktop behind a transparent window. This uses “simple” fullscreen so your wallpaper stays visible."
          on={fullscreen}
          onToggle={toggleFullscreen}
        />

        <AccessKeysManager />
      </div>
    </div>
  );
}

/** A labelled on/off pill switch. */
function SwitchRow({ label, hint, on, onToggle }: { label: string; hint?: string; on: boolean; onToggle: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13 }}>{label}</div>
        {hint && <div className="faint" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={on}
        style={{
          flexShrink: 0, width: 42, height: 24, borderRadius: 999, border: "1px solid var(--border-strong)",
          background: on ? "rgb(var(--primary) / 0.55)" : "rgba(255,255,255,0.05)", cursor: "pointer",
          position: "relative", transition: "background .18s", marginTop: 1,
        }}
      >
        <span style={{
          position: "absolute", top: 2, left: on ? 20 : 2, width: 18, height: 18, borderRadius: 999,
          background: "#fff", transition: "left .18s",
        }} />
      </button>
    </div>
  );
}

/** A labelled range slider that live-reports its value. */
function SliderRow({
  label, hint, value, min, max, suffix, onChange,
}: {
  label: string; hint?: string; value: number; min: number; max: number; suffix?: string; onChange: (v: number) => void;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 13, flex: 1 }}>{label}</span>
        <span className="mono faint" style={{ fontSize: 11 }}>{value}{suffix}</span>
      </div>
      {hint && <div className="faint" style={{ fontSize: 11, margin: "3px 0 6px", lineHeight: 1.5 }}>{hint}</div>}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "rgb(var(--primary-soft))", cursor: "pointer" }}
      />
    </div>
  );
}

const labelStyle: React.CSSProperties = { display: "block", marginBottom: 7, fontSize: 12.5 };
const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", padding: "12px 14px", borderRadius: 10,
  border: "1px solid var(--border)", background: "rgba(255,255,255,.03)", color: "var(--text)",
  fontSize: 13.5, outline: "none", caretColor: "rgb(var(--primary-soft))",
};
const iconBtn: React.CSSProperties = {
  border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)",
  borderRadius: 8, width: 28, height: 28, cursor: "pointer", fontSize: 12,
};
