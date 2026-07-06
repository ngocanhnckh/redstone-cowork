import { Fragment, useEffect, useRef, useState } from "react";
import { useStore } from "../store";

// Browser Inspector: a Chrome-devtools-style Console + Network view for the
// focused session's in-app browser, streamed from the main process over CDP.
// Styled in the app's warm-ink glass theme — a lively, futuristic HUD console.

type ConsoleRow = { rowId: number; level: string; text: string; source?: string; ts: number };
type Headers = Record<string, string>;
type NetRow = {
  id: string; method: string; url: string; resType: string; ts: number;
  status?: number; statusText?: string; mime?: string; size?: number; failed?: boolean; error?: string; canceled?: boolean;
  endedAt?: number; // wall-clock completion (for the waterfall bar)
  reqHeaders?: Headers; resHeaders?: Headers; postData?: string; remoteIP?: string; protocol?: string;
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
function fmtDur(ms: number): string {
  if (ms < 0) return "";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;
}
function fmtTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

type LevelMeta = { label: string; color: string; text: string; bg: string };
function levelMeta(level: string): LevelMeta {
  if (level === "error")
    return { label: "ERR", color: "#e0736a", text: "#f0a59d", bg: "rgba(224,115,106,0.09)" };
  if (level === "warning" || level === "warn")
    return { label: "WRN", color: "rgb(var(--accent))", text: "rgb(var(--accent))", bg: "rgb(var(--accent) / 0.07)" };
  if (level === "info")
    return { label: "INF", color: "rgb(var(--primary-soft))", text: "var(--text)", bg: "transparent" };
  return { label: "LOG", color: "var(--text-faint)", text: "var(--text-soft)", bg: "transparent" };
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

const DT_CSS = `
.dt-body { position: relative; }
.dt-scan { position:absolute; inset:0; pointer-events:none; z-index:3; opacity:.22;
  background: repeating-linear-gradient(to bottom, transparent 0 2px, rgb(var(--primary-soft) / 0.05) 3px, transparent 4px);
  animation: dt-scan 7s linear infinite; }
@keyframes dt-scan { from { background-position:0 0; } to { background-position:0 240px; } }
.dt-row { animation: dt-in .2s ease both; }
@keyframes dt-in { from { opacity:0; transform: translateX(-9px); } to { opacity:1; transform:none; } }
.dt-nrow { animation: dt-fade .22s ease both; }
@keyframes dt-fade { from { opacity:0; } to { opacity:1; } }
.dt-crow { position:relative; transition: background .15s; }
.dt-crow:hover { filter: brightness(1.18); }
.dt-nrow:hover td { background: rgb(var(--primary) / 0.08); }
.dt-badge { font-size:8.5px; font-weight:700; letter-spacing:.1em; padding:1px 5px; border-radius:5px;
  border:1px solid currentColor; line-height:1.3; box-shadow: 0 0 8px -3px currentColor; }
.dt-chip { font-size:9px; font-weight:600; letter-spacing:.04em; padding:1px 6px; border-radius:5px;
  border:1px solid var(--border-strong); color:var(--text-soft); }
.dt-pill { font-size:10px; font-weight:700; padding:1px 8px; border-radius:999px;
  border:1px solid currentColor; box-shadow: inset 0 0 10px -6px currentColor, 0 0 8px -4px currentColor; }
.dt-tab { position:relative; border:1px solid var(--border); border-radius:8px; padding:4px 12px; font-size:11.5px;
  cursor:pointer; font-family:var(--font-mono); text-transform:uppercase; letter-spacing:.06em; transition: color .15s, background .15s; }
.dt-tab-on { color:#fff; background:rgb(var(--primary) / 0.26); border-color:rgb(var(--primary-soft) / 0.5);
  box-shadow: 0 0 14px -6px rgb(var(--primary-soft) / 0.9), inset 0 0 12px -8px rgb(var(--accent)); }
.dt-tab-off { color:var(--text-soft); background:transparent; }
.dt-count { margin-left:7px; font-size:9px; opacity:.7; padding:0 5px; border-radius:999px; background:rgb(255 255 255 / 0.06); }
.dt-wf { position:relative; height:9px; border-radius:999px; background:rgb(255 255 255 / 0.05);
  box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.04); overflow:hidden; }
.dt-wf-bar { position:absolute; top:0; height:100%; min-width:2px; border-radius:999px; background:currentColor;
  box-shadow: 0 0 9px -2px currentColor; opacity:.9;
  background-image: linear-gradient(90deg, rgb(255 255 255 / 0.28), transparent 55%); }
.dt-wf-live { animation: dt-wf-pulse 1s ease-in-out infinite; }
@keyframes dt-wf-pulse { 0%,100% { opacity:.5; } 50% { opacity:1; } }
.dt-nrow.dt-sel td { background: rgb(var(--primary) / 0.14) !important; }
.dt-modal { position:absolute; inset:0; z-index:20; display:flex; flex-direction:column;
  background: color-mix(in srgb, var(--app-panel) 80%, transparent); backdrop-filter: blur(16px) saturate(1.35);
  animation: dt-modal-in .16s cubic-bezier(.2,.8,.2,1) both; }
@keyframes dt-modal-in { from { opacity:0; transform: scale(.985) translateY(6px); } to { opacity:1; transform:none; } }
.dt-kv { display:grid; grid-template-columns: minmax(110px, 32%) 1fr; gap:3px 12px; font-size:11px; font-family:var(--font-mono); }
.dt-kv dt { color: var(--text-faint); overflow-wrap:anywhere; }
.dt-kv dd { margin:0; color: var(--text); overflow-wrap:anywhere; white-space:pre-wrap; }
.dt-sec { font-size:9px; letter-spacing:.16em; text-transform:uppercase; color: rgb(var(--primary-soft)); margin: 14px 0 7px;
  display:flex; align-items:center; gap:8px; }
.dt-sec::after { content:""; flex:1; height:1px; background: linear-gradient(90deg, rgb(var(--primary-soft) / 0.4), transparent); }
.dt-pre { margin:0; padding:10px 12px; border:1px solid var(--border); border-radius:9px; background: rgba(0,0,0,0.28);
  font-family:var(--font-mono); font-size:11px; line-height:1.5; color:var(--text-soft); white-space:pre-wrap; overflow-wrap:anywhere; }
`;

export default function DevToolsPanel({ sessionId, active }: { sessionId?: string; active: boolean }) {
  const [tab, setTab] = useState<"console" | "network">("console");
  const [rows, setRows] = useState<ConsoleRow[]>([]);
  const [net, setNet] = useState<NetRow[]>([]);
  const [filter, setFilter] = useState("");
  const [selId, setSelId] = useState<string | null>(null); // network row shown in the detail modal
  const [attached, setAttached] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const rowSeq = useRef(0);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const netTailing = useRef(true); // network tab tails the newest request
  const netIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openBrowsers = useStore((s) => s.openBrowsers);
  const browserOpen = !!sessionId && openBrowsers.includes(sessionId);

  // Stream console + network events for this session while the panel is live.
  useEffect(() => {
    if (!active || !sessionId) return;
    setAttached(false);
    const off = window.cowork.onDevtoolsEvent(({ sessionId: sid, ev }) => {
      if (sid !== sessionId) return;
      const kind = ev.kind as string;
      if (kind === "attached") {
        setAttached(true);
      } else if (kind === "console") {
        setRows((cur) => {
          const next = [...cur, { rowId: ++rowSeq.current, level: String(ev.level ?? "log"), text: String(ev.text ?? ""), source: ev.source as string | undefined, ts: Number(ev.ts) || 0 }];
          return next.length > MAX_CONSOLE ? next.slice(-MAX_CONSOLE) : next;
        });
      } else if (kind === "net-request") {
        setNet((cur) => {
          const next = [...cur, { id: String(ev.id), method: String(ev.method ?? "GET"), url: String(ev.url ?? ""), resType: String(ev.resType ?? ""), reqHeaders: (ev.reqHeaders as Headers) ?? {}, postData: ev.postData as string | undefined, ts: Number(ev.ts) || 0 }];
          return next.length > MAX_NET ? next.slice(-MAX_NET) : next;
        });
      } else if (kind === "net-response") {
        setNet((cur) => cur.map((r) => (r.id === ev.id ? { ...r, status: Number(ev.status) || 0, statusText: String(ev.statusText ?? ""), mime: String(ev.mime ?? ""), resType: (ev.resType as string) || r.resType, resHeaders: (ev.resHeaders as Headers) ?? {}, remoteIP: String(ev.remoteIP ?? ""), protocol: String(ev.protocol ?? "") } : r)));
      } else if (kind === "net-done") {
        setNet((cur) => cur.map((r) => (r.id === ev.id ? { ...r, size: Number(ev.size) || 0, endedAt: Date.now() } : r)));
      } else if (kind === "net-failed") {
        setNet((cur) => cur.map((r) => (r.id === ev.id ? { ...r, failed: true, error: String(ev.error ?? "failed"), canceled: !!ev.canceled, endedAt: Date.now() } : r)));
      }
    });
    window.cowork.startDevtools(sessionId).then((r) => { if (r?.ok) setAttached(true); }).catch(() => {});
    return () => { off(); window.cowork.stopDevtools(sessionId).catch(() => {}); };
  }, [active, sessionId, browserOpen]);

  // Auto-scroll the console to the newest line.
  useEffect(() => {
    if (tab === "console") consoleEndRef.current?.scrollIntoView({ block: "end" });
  }, [rows.length, tab]);

  // Tick a clock while the Network tab is live so the waterfall domain advances
  // and in-flight bars keep growing until their request completes.
  useEffect(() => {
    if (tab !== "network" || !active) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [tab, active]);

  // Network tab tails the newest request. If you scroll up it stops tailing, then
  // resumes after 1 minute of no scrolling (same behaviour as the Docker log).
  useEffect(() => {
    if (tab === "network" && netTailing.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [net.length, tab]);
  useEffect(() => () => { if (netIdleTimer.current) clearTimeout(netIdleTimer.current); }, []);
  const onBodyScroll = () => {
    if (tab !== "network") return;
    const el = bodyRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (netIdleTimer.current) { clearTimeout(netIdleTimer.current); netIdleTimer.current = null; }
    if (nearBottom) {
      netTailing.current = true;
    } else {
      netTailing.current = false;
      netIdleTimer.current = setTimeout(() => {
        netTailing.current = true;
        if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
      }, 60_000);
    }
  };

  const clear = () => { setRows([]); setNet([]); };
  const q = filter.trim().toLowerCase();
  const visRows = q ? rows.filter((r) => r.text.toLowerCase().includes(q) || r.source?.toLowerCase().includes(q)) : rows;
  const visNet = q ? net.filter((r) => r.url.toLowerCase().includes(q) || String(r.status ?? "").includes(q)) : net;
  const errCount = rows.reduce((n, r) => n + (r.level === "error" ? 1 : 0), 0);

  // Waterfall domain: earliest request start → latest completion (or `now` for
  // anything still in flight), so every bar is positioned on a shared timeline.
  const t0 = visNet.length ? Math.min(...visNet.map((r) => r.ts)) : now;
  const t1 = visNet.length ? Math.max(now, ...visNet.map((r) => r.endedAt ?? now)) : now + 1;
  const span = Math.max(1, t1 - t0);

  const selected = net.find((r) => r.id === selId) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, position: "relative" }}>
      <style>{DT_CSS}</style>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "linear-gradient(180deg, rgb(var(--primary) / 0.05), transparent)" }}>
        {(["console", "network"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`dt-tab ${tab === t ? "dt-tab-on" : "dt-tab-off"}`}>
            {t}
            <span className="dt-count mono">{t === "console" ? rows.length : net.length}</span>
          </button>
        ))}
        {errCount > 0 && (
          <span className="dt-pill mono" style={{ color: "#e0736a", flexShrink: 0 }} title={`${errCount} console errors`}>✖ {errCount}</span>
        )}
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="⌕ filter…"
          className="mono"
          style={{
            flex: 1, minWidth: 40, marginLeft: 2, border: "1px solid var(--border)", background: "rgba(255,255,255,0.03)",
            color: "var(--text)", borderRadius: 8, padding: "5px 10px", fontSize: 11.5, outline: "none",
          }}
        />
        <span title={attached ? "Inspector attached to the browser" : "Waiting for the browser…"}
          className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", flexShrink: 0, color: attached ? "#6bbf82" : "var(--text-faint)" }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "currentColor", boxShadow: attached ? "0 0 8px 1px currentColor" : "none" }} className={attached ? "hud-pulse" : undefined} />
          {attached ? "live" : "idle"}
        </span>
        <button onClick={clear} title="Clear" style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 8, padding: "5px 9px", fontSize: 11, cursor: "pointer", flexShrink: 0 }}>⌫</button>
      </div>

      {/* Body */}
      <div ref={bodyRef} onScroll={onBodyScroll} className="no-scrollbar dt-body" style={{ flex: 1, minHeight: 0, overflow: "auto", background: "radial-gradient(120% 100% at 0% 0%, rgb(var(--primary) / 0.05), rgba(0,0,0,0.28) 70%)" }}>
        <div className="dt-scan" />
        {!browserOpen ? (
          <div className="mono faint" style={{ padding: 16, fontSize: 12, lineHeight: 1.6, position: "relative", zIndex: 1 }}>
            Open the <b style={{ color: "var(--text-soft)" }}>Browser</b> window for this session — the Inspector attaches to its console &amp; network traffic.
          </div>
        ) : tab === "console" ? (
          <div style={{ padding: "6px 0", fontFamily: "var(--font-mono)", fontSize: 11.5, lineHeight: 1.55, position: "relative", zIndex: 1 }}>
            {visRows.length === 0 && <div className="faint" style={{ padding: "6px 14px" }}>No console output yet — interact with the page or reload it.</div>}
            {visRows.map((r) => {
              const m = levelMeta(r.level);
              return (
                <div key={r.rowId} className="dt-row dt-crow" style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "3px 12px 3px 9px", borderLeft: `2px solid ${m.color}`, background: m.bg }}>
                  <span className="dt-badge" style={{ color: m.color, flexShrink: 0, marginTop: 1 }}>{m.label}</span>
                  <span style={{ flex: 1, minWidth: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: m.text }}>{r.text}</span>
                  {r.source && <span className="faint" style={{ flexShrink: 0, fontSize: 9.5, opacity: 0.55 }}>{r.source}</span>}
                  <span style={{ flexShrink: 0, fontSize: 9, opacity: 0.4, color: "var(--text-faint)", marginTop: 1 }}>{fmtTime(r.ts)}</span>
                </div>
              );
            })}
            <div ref={consoleEndRef} />
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-mono)", fontSize: 11, position: "relative", zIndex: 1 }}>
            <thead>
              <tr style={{ position: "sticky", top: 0, background: "color-mix(in srgb, var(--app-panel) 92%, transparent)", color: "var(--text-faint)", textAlign: "left", zIndex: 2 }}>
                <th style={thStyle}>Name</th>
                <th style={{ ...thStyle, width: 62 }}>Method</th>
                <th style={{ ...thStyle, width: 60 }}>Status</th>
                <th style={{ ...thStyle, width: 78 }}>Type</th>
                <th style={{ ...thStyle, width: 60, textAlign: "right" }}>Size</th>
                <th style={{ ...thStyle, minWidth: 150 }}>Waterfall</th>
              </tr>
            </thead>
            <tbody>
              {visNet.length === 0 && (
                <tr><td colSpan={6} className="faint" style={{ padding: "8px 12px" }}>No requests yet — reload the page to capture its traffic.</td></tr>
              )}
              {visNet.map((r) => {
                const sc = statusColor(r);
                const inflight = !r.endedAt && !r.failed;
                const end = r.endedAt ?? now;
                const left = ((r.ts - t0) / span) * 100;
                const width = Math.max(1.5, ((end - r.ts) / span) * 100);
                const barColor = inflight ? "rgb(var(--primary-soft))" : sc;
                return (
                  <tr key={r.id} onClick={() => setSelId(r.id)} className={`dt-nrow ${selId === r.id ? "dt-sel" : ""}`} style={{ borderBottom: "1px solid rgb(255 255 255 / 0.03)", cursor: "pointer" }} title={r.url}>
                    <td style={{ ...tdStyle, color: "var(--text)", maxWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{basename(r.url)}</td>
                    <td style={tdStyle}><span className="dt-chip">{r.method}</span></td>
                    <td style={tdStyle}><span className="dt-pill" style={{ color: sc }}>{r.failed ? (r.canceled ? "CANC" : "FAIL") : r.status || "···"}</span></td>
                    <td style={{ ...tdStyle, color: "var(--text-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.resType || (r.mime ? r.mime.split(";")[0] : "—")}</td>
                    <td style={{ ...tdStyle, color: "var(--text-soft)", textAlign: "right" }}>{fmtBytes(r.size)}</td>
                    <td style={{ ...tdStyle, minWidth: 150 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div className="dt-wf" style={{ flex: 1 }}>
                          <div className={`dt-wf-bar ${inflight ? "dt-wf-live" : ""}`} style={{ left: `${left}%`, width: `${width}%`, color: barColor }} />
                        </div>
                        <span style={{ flexShrink: 0, width: 46, textAlign: "right", fontSize: 9.5, color: inflight ? "rgb(var(--primary-soft))" : "var(--text-faint)" }}>
                          {inflight ? "···" : fmtDur(end - r.ts)}
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail modal for the selected request */}
      {selected && <NetDetail row={selected} sessionId={sessionId} onClose={() => setSelId(null)} />}
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "6px 10px", fontWeight: 500, fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", borderBottom: "1px solid var(--border)" };
const tdStyle: React.CSSProperties = { padding: "4px 10px" };

/** Rows of a header map as a definition list (empty state when absent). */
function HeaderList({ h }: { h?: Headers }) {
  const entries = Object.entries(h ?? {});
  if (entries.length === 0) return <div className="faint" style={{ fontSize: 11 }}>— none —</div>;
  return (
    <dl className="dt-kv">
      {entries.map(([k, v]) => (
        <Fragment key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/** Pretty-print a string as JSON when possible, else return it unchanged. */
function prettyMaybe(s: string): string {
  const t = s.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return s;
  try { return JSON.stringify(JSON.parse(t), null, 2); } catch { return s; }
}

/** Parse a body string into an object/array if it's valid JSON, else undefined. */
function asJson(s: string): unknown | undefined {
  const t = s.trim();
  if (!t || (t[0] !== "{" && t[0] !== "[")) return undefined;
  try {
    const v = JSON.parse(t);
    return v !== null && typeof v === "object" ? v : undefined;
  } catch { return undefined; }
}

const JC = {
  key: "rgb(var(--primary-soft))", string: "#8fce9b", number: "rgb(var(--accent))",
  bool: "rgb(var(--primary-soft))", null: "var(--text-faint)", punct: "var(--text-faint)",
};
function JsonPrim({ value }: { value: unknown }) {
  if (value === null) return <span style={{ color: JC.null }}>null</span>;
  const t = typeof value;
  if (t === "string") return <span style={{ color: JC.string, overflowWrap: "anywhere" }}>{JSON.stringify(value)}</span>;
  if (t === "number" || t === "boolean") return <span style={{ color: t === "number" ? JC.number : JC.bool }}>{String(value)}</span>;
  return <span>{String(value)}</span>;
}
/** One node of a collapsible, syntax-colored JSON tree (objects/arrays expandable). */
function JsonNode({ k, value, last, depth }: { k?: string; value: unknown; last: boolean; depth: number }) {
  const isObj = value !== null && typeof value === "object";
  const [open, setOpen] = useState(depth < 2); // auto-expand the first couple of levels
  const keyEl = k !== undefined ? (<><span style={{ color: JC.key }}>&quot;{k}&quot;</span><span style={{ color: JC.punct }}>: </span></>) : null;
  const gutter = <span style={{ display: "inline-block", width: 12, color: "var(--text-faint)", fontSize: 9 }} />;
  if (!isObj) {
    return <div>{gutter}{keyEl}<JsonPrim value={value} />{!last && <span style={{ color: JC.punct }}>,</span>}</div>;
  }
  const arr = Array.isArray(value);
  const entries: [string | undefined, unknown][] = arr
    ? (value as unknown[]).map((v) => [undefined, v])
    : Object.entries(value as Record<string, unknown>);
  const O = arr ? "[" : "{", C = arr ? "]" : "}";
  return (
    <div>
      <div onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer" }}>
        <span style={{ display: "inline-block", width: 12, color: "var(--text-faint)", fontSize: 9 }}>{open ? "▾" : "▸"}</span>
        {keyEl}<span style={{ color: JC.punct }}>{O}</span>
        {!open && <span style={{ color: "var(--text-faint)" }}> {entries.length}{arr ? " items " : " keys "}{C}{!last ? "," : ""}</span>}
      </div>
      {open && (
        <>
          <div style={{ marginLeft: 13, borderLeft: "1px solid rgb(255 255 255 / 0.06)", paddingLeft: 6 }}>
            {entries.map(([kk, vv], i) => <JsonNode key={i} k={kk} value={vv} last={i === entries.length - 1} depth={depth + 1} />)}
          </div>
          <div>{gutter}<span style={{ color: JC.punct }}>{C}</span>{!last && <span style={{ color: JC.punct }}>,</span>}</div>
        </>
      )}
    </div>
  );
}

/**
 * A futuristic detail overlay for one network request — General / Headers /
 * Payload / Response, with the response body fetched on demand over CDP. Rendered
 * inside the Inspector window (absolute overlay), Esc or ✕ to close.
 */
function NetDetail({ row, sessionId, onClose }: { row: NetRow; sessionId?: string; onClose: () => void }) {
  const [sub, setSub] = useState<"general" | "headers" | "payload" | "response">("general");
  const [body, setBody] = useState<string | null>(null);
  const [bodyState, setBodyState] = useState<"idle" | "loading" | "empty" | "err">("idle");
  const [respView, setRespView] = useState<"pretty" | "raw">("pretty");
  const [copied, setCopied] = useState(false);

  // Fetch the response body the first time the Response tab is opened.
  useEffect(() => {
    if (sub !== "response" || body !== null || bodyState !== "idle" || !sessionId) return;
    setBodyState("loading");
    window.cowork.getDevtoolsBody(sessionId, row.id).then((r) => {
      if (!r) { setBodyState("empty"); return; }
      let text = r.body;
      if (r.base64Encoded) { try { text = atob(r.body); } catch { /* keep raw */ } }
      setBody(text); setBodyState("idle");
    }).catch(() => setBodyState("err"));
  }, [sub, body, bodyState, sessionId, row.id]);

  // Esc closes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const sc = statusColor(row);
  const dur = row.endedAt ? fmtDur(row.endedAt - row.ts) : row.failed ? "—" : "pending";
  const copy = (text: string) => { navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => {}); };
  const SUBS: { k: typeof sub; label: string }[] = [
    { k: "general", label: "General" },
    { k: "headers", label: "Headers" },
    { k: "payload", label: "Payload" },
    { k: "response", label: "Response" },
  ];

  return (
    <div className="dt-modal">
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "linear-gradient(180deg, rgb(var(--primary) / 0.08), transparent)" }}>
        <span className="dt-chip" style={{ flexShrink: 0 }}>{row.method}</span>
        <span className="dt-pill mono" style={{ color: sc, flexShrink: 0 }}>{row.failed ? (row.canceled ? "CANC" : "FAIL") : row.status || "···"}</span>
        <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={row.url}>{basename(row.url)}</span>
        <button onClick={onClose} title="Close (Esc)" style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 7, padding: "3px 10px", fontSize: 12, cursor: "pointer", flexShrink: 0 }}>✕</button>
      </div>
      {/* sub-tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", flexShrink: 0 }}>
        {SUBS.map((s) => (
          <button key={s.k} onClick={() => setSub(s.k)} className={`dt-tab ${sub === s.k ? "dt-tab-on" : "dt-tab-off"}`} style={{ fontSize: 10.5, padding: "3px 11px" }}>{s.label}</button>
        ))}
      </div>
      {/* content */}
      <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "4px 14px 16px" }}>
        {sub === "general" && (
          <dl className="dt-kv">
            <dt>Request URL</dt><dd>{row.url}</dd>
            <dt>Method</dt><dd>{row.method}</dd>
            <dt>Status</dt><dd style={{ color: sc }}>{row.failed ? (row.error ?? "failed") : `${row.status ?? "—"} ${row.statusText ?? ""}`}</dd>
            <dt>Type</dt><dd>{row.resType || row.mime || "—"}</dd>
            <dt>MIME</dt><dd>{row.mime || "—"}</dd>
            <dt>Remote address</dt><dd>{row.remoteIP || "—"}</dd>
            <dt>Protocol</dt><dd>{row.protocol || "—"}</dd>
            <dt>Size</dt><dd>{fmtBytes(row.size)}</dd>
            <dt>Duration</dt><dd>{dur}</dd>
            <dt>Started</dt><dd>{fmtTime(row.ts)}</dd>
          </dl>
        )}
        {sub === "headers" && (
          <>
            <div className="dt-sec">Response headers</div>
            <HeaderList h={row.resHeaders} />
            <div className="dt-sec">Request headers</div>
            <HeaderList h={row.reqHeaders} />
          </>
        )}
        {sub === "payload" && (
          row.postData ? (() => {
            const j = asJson(row.postData);
            return j !== undefined
              ? <div className="dt-pre" style={{ overflowX: "auto" }}><JsonNode value={j} last depth={0} /></div>
              : <pre className="dt-pre">{prettyMaybe(row.postData)}</pre>;
          })()
            : <div className="faint" style={{ fontSize: 11.5, paddingTop: 6 }}>No request payload{row.method === "GET" ? " (GET request)" : ""}.</div>
        )}
        {sub === "response" && (
          bodyState === "loading" ? <div className="faint mono hud-blink" style={{ fontSize: 11.5, paddingTop: 6 }}>fetching response body…</div>
            : bodyState === "empty" ? <div className="faint" style={{ fontSize: 11.5, paddingTop: 6 }}>Body not available (it may have been evicted, or the request is still in flight — reload to re-capture).</div>
            : bodyState === "err" ? <div style={{ fontSize: 11.5, paddingTop: 6, color: "#e0736a" }}>Could not read the response body.</div>
            : body !== null ? (() => {
                const json = asJson(body);
                const showTree = json !== undefined && respView === "pretty";
                return (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      {json !== undefined && (
                        <div style={{ display: "flex", gap: 4 }}>
                          <button onClick={() => setRespView("pretty")} className={`dt-tab ${respView === "pretty" ? "dt-tab-on" : "dt-tab-off"}`} style={{ fontSize: 9.5, padding: "2px 9px" }}>object</button>
                          <button onClick={() => setRespView("raw")} className={`dt-tab ${respView === "raw" ? "dt-tab-on" : "dt-tab-off"}`} style={{ fontSize: 9.5, padding: "2px 9px" }}>raw</button>
                        </div>
                      )}
                      <span style={{ flex: 1 }} />
                      <button onClick={() => copy(body)} className="mono" style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 6, padding: "3px 9px", fontSize: 10.5, cursor: "pointer" }}>{copied ? "copied" : "copy"}</button>
                    </div>
                    {showTree ? (
                      <div className="dt-pre" style={{ overflowX: "auto" }}>
                        <JsonNode value={json} last depth={0} />
                      </div>
                    ) : (
                      <pre className="dt-pre">{prettyMaybe(body).slice(0, 200_000)}</pre>
                    )}
                  </>
                );
              })() : <div className="faint" style={{ fontSize: 11.5, paddingTop: 6 }}>Open to load the response body.</div>
        )}
      </div>
    </div>
  );
}
