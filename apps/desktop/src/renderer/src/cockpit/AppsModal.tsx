import { useRef, useState } from "react";
import type { CustomApp } from "./CustomAppPanel";

/** Normalize a typed address into a loadable URL (default to https). */
function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", border: "1px solid var(--border)", background: "rgba(255,255,255,0.03)",
  color: "var(--text)", borderRadius: 9, padding: "9px 11px", fontSize: 13, outline: "none", fontFamily: "var(--font-body)",
};

/** Render an app icon (data-URL / http favicon → <img>, otherwise emoji/text). */
export function AppIcon({ icon, size = 18 }: { icon: string | null; size?: number }) {
  if (icon && (icon.startsWith("data:") || /^https?:\/\//i.test(icon))) {
    return <img src={icon} alt="" style={{ width: size, height: size, objectFit: "contain", borderRadius: 4 }} />;
  }
  return <span style={{ fontSize: size - 2, lineHeight: 1 }}>{icon || "◍"}</span>;
}

/**
 * Add & manage custom apps. Each app is a name + URL + optional icon; when no icon
 * is chosen the site's favicon is used automatically once the app first loads.
 */
export default function AppsModal({
  apps, workspaceKey, workspaceName, onAdd, onRemove, onClose,
}: {
  apps: CustomApp[];
  /** Current workspace key (`machine:cwd`) or null when no session is focused. */
  workspaceKey: string | null;
  /** Human-readable current workspace name (project) for the checkbox label. */
  workspaceName: string | null;
  onAdd: (app: CustomApp) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [wsOnly, setWsOnly] = useState(false);
  const [ownProfile, setOwnProfile] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const pickImage = (file: File) => {
    if (file.size > 512 * 1024) { setErr("icon image must be under 512 KB"); return; }
    const reader = new FileReader();
    reader.onload = () => setIcon(typeof reader.result === "string" ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const submit = () => {
    const finalUrl = normalizeUrl(url);
    if (!name.trim()) { setErr("name is required"); return; }
    if (!finalUrl) { setErr("url is required"); return; }
    try { new URL(finalUrl); } catch { setErr("that doesn't look like a valid URL"); return; }
    // Unique-ish id without Date.now(): time-ish counter + name slug.
    const id = `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}-${++seq.current}${apps.length}`;
    onAdd({ id, name: name.trim(), url: finalUrl, icon, workspace: wsOnly ? workspaceKey : null, sessionProfile: ownProfile });
    setName(""); setUrl(""); setIcon(null); setWsOnly(false); setOwnProfile(false); setErr(null);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2147483000, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width: 440, maxWidth: "92vw", maxHeight: "86vh", overflowY: "auto", borderRadius: 16, padding: 18,
        border: "1px solid var(--border-strong)", boxShadow: "0 24px 70px rgb(0 0 0 / 0.6)",
        background: "color-mix(in srgb, var(--app-panel, #1b1712) 96%, transparent)",
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <span className="display" style={{ fontSize: 16 }}>Custom apps</span>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 8, padding: "3px 9px", cursor: "pointer", fontSize: 13 }}>✕</button>
        </div>

        {/* Existing apps */}
        {apps.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 5, marginBottom: 16 }}>
            {apps.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 10px", borderRadius: 9, border: "1px solid var(--border)" }}>
                <AppIcon icon={a.icon} size={20} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                    {a.workspace && (
                      <span className="mono" title={`Only in workspace: ${a.workspace}`} style={{ flexShrink: 0, fontSize: 8.5, letterSpacing: "0.06em", textTransform: "uppercase", padding: "1px 6px", borderRadius: 999, background: "rgb(var(--primary) / 0.18)", color: "var(--text-soft)" }}>
                        workspace
                      </span>
                    )}
                    {a.sessionProfile && (
                      <span className="mono" title="Isolated browser profile" style={{ flexShrink: 0, fontSize: 8.5, letterSpacing: "0.06em", textTransform: "uppercase", padding: "1px 6px", borderRadius: 999, background: "rgb(var(--accent) / 0.16)", color: "var(--text-soft)" }}>
                        profile
                      </span>
                    )}
                  </div>
                  <div className="mono faint" style={{ fontSize: 10, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.url}</div>
                </div>
                <button onClick={() => onRemove(a.id)} title="Remove app" style={{ border: "1px solid var(--border)", background: "transparent", color: "#e0736a", borderRadius: 8, padding: "3px 9px", cursor: "pointer", fontSize: 12 }}>remove</button>
              </div>
            ))}
          </div>
        )}

        {/* Add form */}
        <div className="kicker" style={{ marginBottom: 8 }}>Add an app</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (e.g. Grafana)" style={field} />
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="URL (e.g. grafana.example.com)" style={field} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 9, border: "1px solid var(--border)", display: "grid", placeItems: "center", flexShrink: 0 }}>
              <AppIcon icon={icon} size={24} />
            </div>
            <input value={icon && !icon.startsWith("data:") && !/^https?:/i.test(icon) ? icon : ""} onChange={(e) => setIcon(e.target.value || null)} placeholder="Emoji icon (optional)" style={{ ...field, flex: 1 }} />
            <button onClick={() => fileRef.current?.click()} style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 9, padding: "9px 12px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>Upload…</button>
            <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) pickImage(f); e.target.value = ""; }} />
          </div>
          <div className="mono faint" style={{ fontSize: 10.5 }}>No icon? The site's favicon is used automatically once it loads.</div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: workspaceKey ? "pointer" : "not-allowed", opacity: workspaceKey ? 1 : 0.5 }}>
            <input type="checkbox" checked={wsOnly} disabled={!workspaceKey} onChange={(e) => setWsOnly(e.target.checked)} style={{ cursor: "inherit" }} />
            <span style={{ fontSize: 12 }}>
              This workspace only
              {workspaceName ? <span className="mono faint" style={{ fontSize: 10.5 }}> — {workspaceName}</span> : <span className="mono faint" style={{ fontSize: 10.5 }}> (focus a session to enable)</span>}
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={ownProfile} onChange={(e) => setOwnProfile(e.target.checked)} style={{ cursor: "pointer", marginTop: 2 }} />
            <span style={{ fontSize: 12 }}>
              Use session profile
              <span className="mono faint" style={{ display: "block", fontSize: 10.5, marginTop: 1 }}>Isolated logins, cookies, storage &amp; cache — not shared with the rest of the app.</span>
            </span>
          </label>
          {err && <div className="mono" style={{ color: "#e0736a", fontSize: 11 }}>{err}</div>}
          <button className="glass-btn--clay" onClick={submit} style={{ padding: "9px 16px", fontSize: 13, fontWeight: 600, alignSelf: "flex-start" }}>＋ Add app</button>
        </div>
      </div>
    </div>
  );
}
