import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

// Browser Inspector: a Chrome-devtools-style Console + Network view for the
// focused session's in-app browser, streamed from the main process over CDP.
// Styled in the app's warm-ink glass theme (not Chrome grey).

type ConsoleRow = { rowId: number; level: string; text: string; source?: string; ts: number };
type NetRow = {
  id: string; method: string; url: string; resType: string; ts: number;
  status?: number; mime?: string; size?: number; failed?: boolean; error?: string; canceled?: boolean;
};

const MAX_CONSOLE = 600;
const MAX_NET = 400;

function basename(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop();
    return (last || u.hostname) + (u.search ? u.search : "");
  } catch {
    return url.slice(0, 60);
  }
}
function fmtBytes(n?: number): string {
  if (!n || n <= 0) return "—";
  const u = ["B", "KB", "MB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
function levelColor(level: string): string {
  if (level === "error") return "#e0736a";
  if (level === "warning" || level === "warn") return "rgb(var(--accent))";
  if (level === "info") return "rgb(var(--primary-soft))";
  return "var(--text-soft)";
}
function statusColor(r: NetRow): string {
  if (r.failed) return "#e0736a";
  const s = r.status ?? 0;
  if (s === 0) return "var(--text-faint)";
  if (s >= 500) return "#e0736a";
  if (s >= 400) return "rgb(var(--accent))";
  if (s >= 300) return "rgb(var(--primary-soft))";
  return "#6bbf82";
}

export default function DevToolsPanel({ sessionId, active }: { sessionId?: string; active: boolean }) {
  const [tab, setTab] = useState<"console" | "network">("console");
  const [rows, setRows] = useState<ConsoleRow[]>([]);
  const [net, setNet] = useState<NetRow[]>([]);
  const [filter, setFilter] = useState("");
  const rowSeq = useRef(0);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const openBrowsers = useStore((s) => s.openBrowsers);
  const browserOpen = !!sessionId && openBrowsers.includes(sessionId);

  // Stream console + network events for this session while the panel is live.
  useEffect(() => {
    if (!active || !sessionId) return;
    const off = window.cowork.onDevtoolsEvent(({ sessionId: sid, ev }) => {
      if (sid !== sessionId) return;
      const kind = ev.kind as string;
      if (kind === "console") {
        setRows((cur) => {
          const next = [...cur, { rowId: ++rowSeq.current, level: String(ev.level ?? "log"), text: String(ev.text ?? ""), source: ev.source as string | undefined, ts: Number(ev.ts) || 0 }];
          return next.length > MAX_CONSOLE ? next.slice(-MAX_CONSOLE) : next;
        });
      } else if (kind === "net-request") {
        setNet((cur) => {
          const next = [...cur, { id: String(ev.id), method: String(ev.method ?? "GET"), url: String(ev.url ?? ""), resType: String(ev.resType ?? ""), ts: Number(ev.ts) || 0 }];
          return next.length > MAX_NET ? next.slice(-MAX_NET) : next;
        });
      } else if (kind === "net-response") {
        setNet((cur) => cur.map((r) => (r.id === ev.id ? { ...r, status: Number(ev.status) || 0, mime: String(ev.mime ?? ""), resType: (ev.resType as string) || r.resType } : r)));
      } else if (kind === "net-done") {
        setNet((cur) => cur.map((r) => (r.id === ev.id ? { ...r, size: Number(ev.size) || 0 } : r)));
      } else if (kind === "net-failed") {
        setNet((cur) => cur.map((r) => (r.id === ev.id ? { ...r, failed: true, error: String(ev.error ?? "failed"), canceled: !!ev.canceled } : r)));
      }
    });
    window.cowork.startDevtools(sessionId).catch(() => {});
    return () => { off(); window.cowork.stopDevtools(sessionId).catch(() => {}); };
  }, [active, sessionId, browserOpen]);

  // Auto-scroll the console to the newest line.
  useEffect(() => {
    if (tab === "console") consoleEndRef.current?.scrollIntoView({ block: "end" });
  }, [rows.length, tab]);

  const clear = () => { setRows([]); setNet([]); };
  const q = filter.trim().toLowerCase();
  const visRows = q ? rows.filter((r) => r.text.toLowerCase().includes(q) || r.source?.toLowerCase().includes(q)) : rows;
  const visNet = q ? net.filter((r) => r.url.toLowerCase().includes(q) || String(r.status ?? "").includes(q)) : net;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        {(["console", "network"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              border: "1px solid var(--border)", borderRadius: 8, padding: "4px 11px", fontSize: 11.5, cursor: "pointer",
              fontFamily: "var(--font-mono)", textTransform: "capitalize",
              background: tab === t ? "rgb(var(--primary) / 0.26)" : "transparent",
              color: tab === t ? "#fff" : "var(--text-soft)",
            }}
          >
            {t}
            <span className="mono" style={{ marginLeft: 6, opacity: 0.6, fontSize: 10 }}>{t === "console" ? rows.length : net.length}</span>
          </button>
        ))}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="mono"
          style={{
            flex: 1, minWidth: 0, marginLeft: 4, border: "1px solid var(--border)", background: "rgba(255,255,255,0.03)",
            color: "var(--text)", borderRadius: 8, padding: "5px 10px", fontSize: 11.5, outline: "none",
          }}
        />
        <button onClick={clear} title="Clear" style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 8, padding: "5px 9px", fontSize: 11, cursor: "pointer" }}>⌫ clear</button>
      </div>

      {/* Body */}
      <div className="no-scrollbar hud-term" style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative", background: "rgba(0,0,0,0.22)" }}>
        {!browserOpen ? (
          <div className="mono faint" style={{ padding: 16, fontSize: 12, lineHeight: 1.6 }}>
            Open the <b style={{ color: "var(--text-soft)" }}>Browser</b> window for this session — the Inspector attaches to its console &amp; network traffic.
          </div>
        ) : tab === "console" ? (
          <div style={{ padding: "6px 0", fontFamily: "var(--font-mono)", fontSize: 11.5, lineHeight: 1.55 }}>
            {visRows.length === 0 && <div className="faint" style={{ padding: "6px 14px" }}>No console output yet.</div>}
            {visRows.map((r) => (
              <div key={r.rowId} style={{ display: "flex", gap: 8, padding: "2px 14px", borderBottom: "1px solid rgb(255 255 255 / 0.02)", color: levelColor(r.level) }}>
                <span style={{ flexShrink: 0, width: 12, textAlign: "center", opacity: 0.8 }} title={r.level}>
                  {r.level === "error" ? "✖" : r.level === "warning" || r.level === "warn" ? "▲" : "›"}
                </span>
                <span style={{ flex: 1, minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{r.text}</span>
                {r.source && <span className="faint" style={{ flexShrink: 0, fontSize: 10, opacity: 0.6 }}>{r.source}</span>}
              </div>
            ))}
            <div ref={consoleEndRef} />
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 11 }}>
            <thead>
              <tr style={{ position: "sticky", top: 0, background: "color-mix(in srgb, var(--app-panel) 92%, transparent)", color: "var(--text-faint)", textAlign: "left" }}>
                <th style={thStyle}>Name</th>
                <th style={{ ...thStyle, width: 58 }}>Method</th>
                <th style={{ ...thStyle, width: 56 }}>Status</th>
                <th style={{ ...thStyle, width: 84 }}>Type</th>
                <th style={{ ...thStyle, width: 66, textAlign: "right" }}>Size</th>
              </tr>
            </thead>
            <tbody>
              {visNet.length === 0 && (
                <tr><td colSpan={5} className="faint" style={{ padding: "8px 12px" }}>No requests yet.</td></tr>
              )}
              {visNet.map((r) => (
                <tr key={r.id} style={{ borderBottom: "1px solid rgb(255 255 255 / 0.03)" }} title={r.url}>
                  <td style={{ ...tdStyle, color: "var(--text)", maxWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{basename(r.url)}</td>
                  <td style={{ ...tdStyle, color: "var(--text-soft)" }}>{r.method}</td>
                  <td style={{ ...tdStyle, color: statusColor(r) }}>{r.failed ? (r.canceled ? "canc" : "fail") : r.status || "—"}</td>
                  <td style={{ ...tdStyle, color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.resType || (r.mime ? r.mime.split(";")[0] : "—")}</td>
                  <td style={{ ...tdStyle, color: "var(--text-faint)", textAlign: "right" }}>{fmtBytes(r.size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "6px 10px", fontWeight: 500, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", borderBottom: "1px solid var(--border)" };
const tdStyle: React.CSSProperties = { padding: "4px 10px" };
