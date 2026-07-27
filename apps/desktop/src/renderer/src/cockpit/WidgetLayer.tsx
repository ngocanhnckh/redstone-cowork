import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import NetMap from "./NetMap";
import Weather from "./Weather";
import type { DiskUsage } from "../../../shared/disk";

// A free-floating widget canvas over the HUD desktop (behind the app windows). Widgets
// are draggable/resizable, glanceable, and persist their placement globally. Every
// widget here is NEW — none duplicate the fixed telemetry deck or the left column.

export type WidgetKind = "attention" | "burn" | "ticker" | "timer" | "scratch" | "throughput" | "radar" | "reactor" | "agenda" | "netmap" | "weather" | "storage";
export type WidgetInst = { id: string; kind: WidgetKind; x: number; y: number; w: number; h: number; text?: string };

const KEY = "rcw.widgets";

type Meta = { label: string; icon: string; w: number; h: number; minW: number; minH: number };
const CATALOG: Record<WidgetKind, Meta> = {
  attention:  { label: "Attention Radar", icon: "◉", w: 260, h: 158, minW: 200, minH: 120 },
  burn:       { label: "Fleet Burn ($)",  icon: "$", w: 210, h: 132, minW: 170, minH: 110 },
  ticker:     { label: "Activity Ticker", icon: "↯", w: 340, h: 74,  minW: 220, minH: 60  },
  timer:      { label: "Focus Timer",     icon: "◔", w: 196, h: 150, minW: 170, minH: 130 },
  scratch:    { label: "Scratch Note",    icon: "✎", w: 224, h: 158, minW: 160, minH: 110 },
  throughput: { label: "Throughput",      icon: "▚", w: 224, h: 128, minW: 180, minH: 108 },
  radar:      { label: "Recon Radar",     icon: "◎", w: 244, h: 244, minW: 190, minH: 190 },
  reactor:    { label: "Top Processes",   icon: "⚛", w: 264, h: 190, minW: 210, minH: 140 },
  agenda:     { label: "Agenda",          icon: "▦", w: 286, h: 214, minW: 220, minH: 150 },
  netmap:     { label: "Network Map",     icon: "⌖", w: 440, h: 340, minW: 320, minH: 250 },
  weather:    { label: "Weather",         icon: "☀", w: 230, h: 180, minW: 190, minH: 150 },
  storage:    { label: "Storage",         icon: "▤", w: 300, h: 214, minW: 240, minH: 168 },
};
const ORDER: WidgetKind[] = ["attention", "netmap", "storage", "weather", "agenda", "reactor", "radar", "burn", "throughput", "ticker", "timer", "scratch"];

function sanitize(p: unknown): WidgetInst[] {
  return Array.isArray(p) ? p.filter((w) => w && typeof w.id === "string" && CATALOG[w.kind as WidgetKind]) : [];
}
function loadWidgets(): WidgetInst[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return null; // never initialised → caller seeds defaults
    return sanitize(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** Read the current widget composition (for snapshotting into a layout template). */
export function readWidgets(): WidgetInst[] {
  return loadWidgets() ?? [];
}
/** Replace the live widget composition (when applying a layout template): persist it
 *  and notify the mounted WidgetLayer to swap in the new set immediately. */
export function applyWidgets(widgets: WidgetInst[]): void {
  const clean = sanitize(widgets);
  try { localStorage.setItem(KEY, JSON.stringify(clean)); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent("rcw-widgets-apply", { detail: clean })); } catch { /* ignore */ }
}

// First-run seed: a couple of high-value widgets so the canvas isn't empty.
const SEED: WidgetInst[] = [
  { id: "seed-attention", kind: "attention", x: 24, y: 24, w: CATALOG.attention.w, h: CATALOG.attention.h },
  { id: "seed-radar", kind: "radar", x: 24, y: 200, w: CATALOG.radar.w, h: CATALOG.radar.h },
];

function projectName(cwd: string): string {
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

// ── The layer ───────────────────────────────────────────────────────────────
export default function WidgetLayer() {
  const [widgets, setWidgets] = useState<WidgetInst[]>(() => loadWidgets() ?? SEED);
  const [pickerOpen, setPickerOpen] = useState(false);
  const layerRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(widgets)); } catch { /* ignore */ }
  }, [widgets]);

  // A layout template being applied replaces the widget composition live.
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent).detail; if (Array.isArray(d)) setWidgets(d); };
    window.addEventListener("rcw-widgets-apply", on as EventListener);
    return () => window.removeEventListener("rcw-widgets-apply", on as EventListener);
  }, []);

  const patch = useCallback((id: string, p: Partial<WidgetInst>) => {
    setWidgets((ws) => ws.map((w) => (w.id === id ? { ...w, ...p } : w)));
  }, []);
  const remove = useCallback((id: string) => setWidgets((ws) => ws.filter((w) => w.id !== id)), []);

  const add = (kind: WidgetKind) => {
    const m = CATALOG[kind];
    const n = ++seq.current;
    // Cascade new widgets so they don't stack exactly on top of each other.
    const off = (widgets.length + n) % 6;
    setWidgets((ws) => [...ws, { id: `w-${kind}-${ws.length}-${n}`, kind, x: 40 + off * 26, y: 40 + off * 26, w: m.w, h: m.h }]);
    setPickerOpen(false);
  };

  return (
    <div ref={layerRef} style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
      <WidgetStyles />
      {widgets.map((w) => (
        <WidgetFrame key={w.id} inst={w} layerRef={layerRef} onChange={(p) => patch(w.id, p)} onRemove={() => remove(w.id)} />
      ))}

      {/* ＋ widgets picker — floats bottom-left of the desktop, pointer-events on. */}
      <div style={{ position: "absolute", left: 14, bottom: 14, pointerEvents: "auto" }}>
        {pickerOpen && (
          <>
            <div onClick={() => setPickerOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 1 }} />
            <div className="glass-menu" style={{ position: "absolute", bottom: "calc(100% + 8px)", left: 0, zIndex: 2, width: 210, padding: 6, borderRadius: 12, border: "1px solid var(--border-strong)", boxShadow: "0 14px 40px rgba(0,0,0,0.55)" }}>
              <div className="mono faint" style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", padding: "4px 8px 6px" }}>Add widget</div>
              {ORDER.map((k) => (
                <button key={k} onClick={() => add(k)} style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", border: "none", background: "transparent", color: "var(--text)", cursor: "pointer", padding: "7px 8px", borderRadius: 8, fontSize: 12.5, textAlign: "left" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(232,230,225,0.16)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <span style={{ width: 18, textAlign: "center", color: "rgb(var(--primary-soft))" }}>{CATALOG[k].icon}</span>
                  {CATALOG[k].label}
                </button>
              ))}
            </div>
          </>
        )}
        <button onClick={() => setPickerOpen((o) => !o)} title="Add a widget to the HUD"
          className="glass-btn--clay" style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", fontSize: 11.5, fontWeight: 600, fontFamily: "var(--font-mono)", letterSpacing: "0.04em", opacity: 0.86 }}>
          ＋ widgets
        </button>
      </div>
    </div>
  );
}

// ── Draggable / resizable frame ───────────────────────────────────────────────
function WidgetFrame({ inst, layerRef, onChange, onRemove }: {
  inst: WidgetInst;
  layerRef: React.RefObject<HTMLDivElement | null>;
  onChange: (p: Partial<WidgetInst>) => void;
  onRemove: () => void;
}) {
  const m = CATALOG[inst.kind];
  const bounds = () => layerRef.current?.getBoundingClientRect() ?? { width: 9999, height: 9999 };

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const b = bounds();
    const sx = e.clientX, sy = e.clientY, ox = inst.x, oy = inst.y;
    const move = (ev: PointerEvent) => {
      const nx = Math.max(0, Math.min(b.width - inst.w, ox + (ev.clientX - sx)));
      const ny = Math.max(0, Math.min(b.height - inst.h, oy + (ev.clientY - sy)));
      onChange({ x: nx, y: ny });
    };
    const up = (ev: PointerEvent) => { try { el.releasePointerCapture(ev.pointerId); } catch { /* */ } el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const b = bounds();
    const sx = e.clientX, sy = e.clientY, ow = inst.w, oh = inst.h;
    const move = (ev: PointerEvent) => {
      const nw = Math.max(m.minW, Math.min(b.width - inst.x, ow + (ev.clientX - sx)));
      const nh = Math.max(m.minH, Math.min(b.height - inst.y, oh + (ev.clientY - sy)));
      onChange({ w: nw, h: nh });
    };
    const up = (ev: PointerEvent) => { try { el.releasePointerCapture(ev.pointerId); } catch { /* */ } el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <div className="rcw-widget hud-card" style={{ position: "absolute", left: inst.x, top: inst.y, width: inst.w, height: inst.h, pointerEvents: "auto" }}>
      <span className="hud-corner" />
      {/* Drag grip + remove — only visible on hover so the canvas stays clean. */}
      <div className="rcw-widget-grip" onPointerDown={startDrag} title="Drag to move">
        <span className="mono" style={{ fontSize: 8.5, letterSpacing: "0.18em", color: "var(--text-faint)" }}>⠿ {m.label.toUpperCase()}</span>
        <span style={{ flex: 1 }} />
        <button onPointerDown={(e) => e.stopPropagation()} onClick={onRemove} title="Remove widget"
          style={{ border: "none", background: "transparent", color: "var(--text-faint)", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: "0 2px" }}>✕</button>
      </div>
      <div style={{ position: "absolute", inset: 0, padding: "10px 12px", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <WidgetBody inst={inst} onChange={onChange} />
      </div>
      <div className="rcw-widget-resize" onPointerDown={startResize} title="Resize" />
    </div>
  );
}

function WidgetBody({ inst, onChange }: { inst: WidgetInst; onChange: (p: Partial<WidgetInst>) => void }) {
  switch (inst.kind) {
    case "attention": return <AttentionRadar />;
    case "burn": return <FleetBurn />;
    case "ticker": return <ActivityTicker />;
    case "timer": return <FocusTimer />;
    case "scratch": return <ScratchNote text={inst.text ?? ""} onChange={(t) => onChange({ text: t })} />;
    case "throughput": return <Throughput />;
    case "radar": return <ReconRadar />;
    case "reactor": return <Reactor />;
    case "agenda": return <Agenda />;
    case "netmap": return <NetMap />;
    case "storage": return <StorageWidget />;
    case "weather": return <Weather />;
    default: return null;
  }
}

// ── Shared bits ───────────────────────────────────────────────────────────────
function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
const kicker = (t: string) => <div className="mono faint" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>{t}</div>;
function fmtAge(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  if (s < 60) return `${s}s`;
  const mnt = Math.floor(s / 60), r = s % 60;
  if (mnt < 60) return `${mnt}m ${String(r).padStart(2, "0")}s`;
  return `${Math.floor(mnt / 60)}h ${String(mnt % 60).padStart(2, "0")}m`;
}

// Per-model USD cost per 1M tokens (input/output). Rough public list-price tiers;
// unknown models fall back to a mid (Sonnet-ish) rate.
function modelRate(model: string | null): { in: number; out: number } {
  const m = (model ?? "").toLowerCase();
  if (m.includes("opus")) return { in: 15, out: 75 };
  if (m.includes("haiku")) return { in: 0.8, out: 4 };
  if (m.includes("sonnet")) return { in: 3, out: 15 };
  return { in: 3, out: 15 };
}

// Fleet-wide token/cost stats derived DIRECTLY from each session's timestamped
// `tokenSeries` (cumulative per-turn totals). We sum per-turn DELTAS that fall in a
// recent window → live tok/min & $/hr + per-minute sparklines, plus lifetime totals.
// Reads BOTH `sessions` and `queue` (the fleet spans both) and dedupes by id — a
// session living only in `queue` was previously missed, so throughput read 0.
// Live throughput reads a tight 10-min window; the burn RATE reads a wider 60-min window
// so bursty, real-world usage (token spend is reported per-turn, minutes apart) still
// registers instead of collapsing to $0.00/hr the moment a session pauses.
const TOK_WINDOW_MIN = 10;
const COST_WINDOW_MIN = 60;
function useFleetSamples(): { totalTok: number; totalCost: number; tokPerMin: number; costPerHr: number; lastBurnMin: number | null; tokSpark: number[]; costSpark: number[] } {
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const now = useNow(5000); // re-derive every 5s so the window slides

  return useMemo(() => {
    const byId = new Map<string, (typeof sessions)[number]>();
    for (const s of [...sessions, ...queue]) if (!byId.has(s.id)) byId.set(s.id, s);
    const all = [...byId.values()];

    let totalTok = 0, totalCost = 0;
    let lastBurnAt = 0; // newest timestamp at which ANY session's tokens grew
    const cutoff = now - COST_WINDOW_MIN * 60_000; // widest lookback
    // Per-minute buckets of tokens & $ spent, for the sparklines + headline rate.
    const tokByMin = new Map<number, number>();
    const costByMin = new Map<number, number>();
    for (const s of all) {
      const r = modelRate(s.model);
      totalTok += (s.tokensInput ?? 0) + (s.tokensOutput ?? 0);
      totalCost += (s.tokensInput ?? 0) / 1e6 * r.in + (s.tokensOutput ?? 0) / 1e6 * r.out;
      const series = s.tokenSeries ?? [];
      for (let i = 1; i < series.length; i++) {
        const t = new Date(series[i].t).getTime();
        if (!Number.isFinite(t)) continue;
        const dIn = Math.max(0, (series[i].input ?? 0) - (series[i - 1].input ?? 0));
        const dOut = Math.max(0, (series[i].output ?? 0) - (series[i - 1].output ?? 0));
        if ((dIn > 0 || dOut > 0) && t > lastBurnAt) lastBurnAt = t;
        if (t < cutoff) continue;
        const min = Math.floor(t / 60_000);
        tokByMin.set(min, (tokByMin.get(min) ?? 0) + dIn + dOut);
        costByMin.set(min, (costByMin.get(min) ?? 0) + dIn / 1e6 * r.in + dOut / 1e6 * r.out);
      }
    }

    const nowMin = Math.floor(now / 60_000);
    // Cost sparkline + $/hr over the last COST_WINDOW_MIN minutes. Because the window is
    // exactly one hour, the summed cost over it IS the $/hr burn rate.
    const costSpark: number[] = [];
    let costWindow = 0;
    for (let m = nowMin - COST_WINDOW_MIN + 1; m <= nowMin; m++) {
      const ct = costByMin.get(m) ?? 0;
      costSpark.push(ct * 60); // $/hr contribution of that minute
      costWindow += ct;
    }
    // Live token throughput over the last TOK_WINDOW_MIN minutes.
    const tokSpark: number[] = [];
    let tokWindow = 0;
    for (let m = nowMin - TOK_WINDOW_MIN + 1; m <= nowMin; m++) {
      const tk = tokByMin.get(m) ?? 0;
      tokSpark.push(tk);
      tokWindow += tk;
    }
    return {
      totalTok, totalCost,
      tokPerMin: tokWindow / TOK_WINDOW_MIN,
      costPerHr: costWindow, // 60-min window → sum is already $/hr
      lastBurnMin: lastBurnAt ? Math.max(0, Math.round((now - lastBurnAt) / 60_000)) : null,
      tokSpark, costSpark,
    };
  }, [sessions, queue, now]);
}

function Spark({ data, color, height = 30 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return <div className="mono faint" style={{ fontSize: 9.5 }}>sampling…</div>;
  const peak = Math.max(1, ...data);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height }}>
      {data.map((v, i) => (
        <div key={i} style={{ flex: 1, minWidth: 2, height: Math.max(2, (v / peak) * height), background: color, borderRadius: 1, opacity: 0.55 + 0.45 * (i / data.length) }} />
      ))}
    </div>
  );
}

// ── Widget: Attention Radar ───────────────────────────────────────────────────
function AttentionRadar() {
  const decisions = useStore((s) => s.decisions);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const now = useNow(1000);
  const rows = useMemo(() => {
    const pool = [...sessions, ...queue];
    return decisions
      .filter((d) => d.kind === "question" || d.kind === "permission" || d.kind === "mode")
      .map((d) => {
        const s = pool.find((x) => x.id === d.sessionId);
        const since = s?.waitingSince ? new Date(s.waitingSince).getTime() : null;
        const age = since ? (now - since) / 1000 : 0;
        return { id: d.id, kind: d.kind, name: s ? projectName(s.cwd) : d.sessionId.slice(0, 8), age };
      })
      .sort((a, b) => b.age - a.age);
  }, [decisions, sessions, queue, now]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
        <span className={rows.length ? "rcw-w-pulse" : ""} style={{ width: 8, height: 8, borderRadius: "50%", background: rows.length ? "rgb(var(--accent))" : "var(--text-faint)" }} />
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)" }}>Needs you{rows.length ? ` · ${rows.length}` : ""}</span>
      </div>
      {rows.length === 0 ? (
        <div className="mono faint" style={{ fontSize: 11, margin: "auto" }}>◇ all clear</div>
      ) : (
        <div className="no-scrollbar" style={{ display: "flex", flexDirection: "column", gap: 5, overflowY: "auto", minHeight: 0 }}>
          {rows.map((r) => {
            const hot = r.age > 120; // >2m waiting → urgent
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: "#e63b2e" }} />
                <span style={{ fontSize: 12, minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                <span className="mono faint" style={{ fontSize: 10, flexShrink: 0 }}>{r.kind[0].toUpperCase()}</span>
                <span className="mono" style={{ fontSize: 10.5, flexShrink: 0, color: hot ? "#e63b2e" : "var(--text-soft)", fontVariantNumeric: "tabular-nums" }}>{fmtAge(r.age)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Widget: Storage ───────────────────────────────────────────────────────────
function fmtSize(kb: number): string {
  const b = kb * 1024;
  if (b >= 1e12) return `${(b / 1e12).toFixed(1)} TB`;
  if (b >= 1e9) return `${(b / 1e9).toFixed(b >= 1e10 ? 0 : 1)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(0)} MB`;
  return `${Math.max(0, Math.round(b / 1e3))} KB`;
}
function usageColor(pct: number): string {
  if (pct >= 90) return "#e63b2e";
  if (pct >= 75) return "#e0a24a";
  return "var(--text)";
}
function StorageWidget() {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const machine = useMemo(() => [...sessions, ...queue].find((x) => x.id === focusId)?.machine ?? null, [focusId, sessions, queue]);
  const [du, setDu] = useState<DiskUsage | null>(null);
  useEffect(() => {
    if (!machine) { setDu(null); return; }
    let alive = true;
    const load = () => {
      if (!alive || document.hidden) return;
      window.cowork.diskUsage(machine).then((r) => { if (alive) setDu(r); }).catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    document.addEventListener("visibilitychange", load);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", load); };
  }, [machine]);

  const mounts = du?.mounts ?? [];
  const main = mounts.find((m) => m.mount === "/") ?? mounts[0] ?? null;
  const R = 30, C = 2 * Math.PI * R;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <span style={{ fontSize: 12 }}>▤</span>
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)" }}>Storage</span>
        <span className="mono faint" style={{ fontSize: 9, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{machine ?? "no host"}</span>
      </div>

      {!machine ? (
        <span className="mono faint" style={{ fontSize: 10.5, margin: "auto" }}>focus a session</span>
      ) : !du ? (
        <span className="mono faint" style={{ fontSize: 10.5, margin: "auto" }}>reading disks…</span>
      ) : !du.ok || !main ? (
        <span className="mono faint" style={{ fontSize: 10.5, margin: "auto" }}>{du.error ? "couldn't read df" : "no filesystems"}</span>
      ) : (
        <>
          {/* main filesystem donut */}
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <svg width="72" height="72" viewBox="0 0 72 72" style={{ flexShrink: 0, transform: "rotate(-90deg)" }}>
              <circle cx="36" cy="36" r={R} fill="none" stroke="var(--border)" strokeWidth="7" />
              <circle cx="36" cy="36" r={R} fill="none" stroke={usageColor(main.pct)} strokeWidth="7" strokeLinecap="round"
                strokeDasharray={`${(main.pct / 100) * C} ${C}`} style={{ transition: "stroke-dasharray .5s ease" }} />
              <text x="36" y="34" transform="rotate(90 36 36)" textAnchor="middle" fontSize="15" fontWeight="700" fill={usageColor(main.pct)} fontFamily="var(--font-display, var(--font-mono))">{main.pct}%</text>
              <text x="36" y="46" transform="rotate(90 36 36)" textAnchor="middle" fontSize="7" fill="var(--text-faint)" fontFamily="var(--font-mono)">USED</text>
            </svg>
            <div style={{ minWidth: 0 }}>
              <div className="mono" style={{ fontSize: 12, color: "var(--text)" }}>{main.mount}</div>
              <div className="mono faint" style={{ fontSize: 10.5, marginTop: 3 }}>{fmtSize(main.usedKb)} / {fmtSize(main.sizeKb)}</div>
              <div className="mono" style={{ fontSize: 10.5, marginTop: 2, color: usageColor(main.pct) }}>{fmtSize(main.availKb)} free</div>
              {main.pct >= 90 && <div className="mono" style={{ fontSize: 9.5, marginTop: 4, color: "#e63b2e", letterSpacing: ".04em" }}>⚠ NEARLY FULL</div>}
            </div>
          </div>

          {/* per-filesystem distribution bars */}
          {mounts.length > 0 && (
            <div className="no-scrollbar" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7, overflowY: "auto", minHeight: 0 }}>
              {mounts.slice(0, 6).map((m) => (
                <div key={m.mount}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
                    <span className="mono" style={{ fontSize: 9.5, color: "var(--text-soft)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.mount}</span>
                    <span className="mono faint" style={{ fontSize: 9, flexShrink: 0 }}>{fmtSize(m.usedKb)} / {fmtSize(m.sizeKb)}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: "var(--border)", overflow: "hidden" }}>
                    <div style={{ width: `${m.pct}%`, height: "100%", borderRadius: 3, background: usageColor(m.pct), transition: "width .5s ease" }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Widget: Fleet Burn ($) ────────────────────────────────────────────────────
function FleetBurn() {
  const { totalCost, costPerHr, lastBurnMin, costSpark } = useFleetSamples();
  const active = costPerHr > 0.005;
  const idleLabel = lastBurnMin == null ? "no recent burn"
    : lastBurnMin < 60 ? `idle · last burn ${lastBurnMin}m ago`
    : `idle · last burn ${Math.round(lastBurnMin / 60)}h ago`;
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      {kicker("Fleet burn")}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 24, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>${totalCost.toFixed(2)}</span>
        <span className="mono faint" style={{ fontSize: 10 }}>total</span>
      </div>
      <div className="mono" style={{ fontSize: 11.5, color: active ? "var(--text)" : "var(--text-faint)", marginTop: 2, marginBottom: 6 }}>
        {active ? <>${costPerHr.toFixed(2)} <span className="faint">/hr · last 60m</span></> : idleLabel}
      </div>
      <div style={{ marginTop: "auto" }}><Spark data={costSpark} color="var(--text-soft)" height={26} /></div>
    </div>
  );
}

// ── Widget: Throughput ────────────────────────────────────────────────────────
function Throughput() {
  const { tokPerMin, tokSpark } = useFleetSamples();
  const fmt = tokPerMin >= 1000 ? `${(tokPerMin / 1000).toFixed(1)}k` : String(Math.round(tokPerMin));
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      {kicker("Throughput")}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 22, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>{fmt}</span>
        <span className="mono faint" style={{ fontSize: 10 }}>tok/min</span>
      </div>
      <div style={{ marginTop: "auto" }}><Spark data={tokSpark} color="rgb(var(--primary-soft))" height={30} /></div>
    </div>
  );
}

// ── Widget: Activity Ticker ───────────────────────────────────────────────────
// Static display of the single latest fleet item ("project › latest snippet").
// No marquee — the display only changes when the data does (quick fade-in on change).
function ActivityTicker() {
  const sessions = useStore((s) => s.sessions);
  const latest = useMemo(() => {
    const items = sessions
      .map((s) => {
        const last = [...(s.transcript ?? [])].reverse().find((m) => m.role === "assistant");
        if (!last) return null;
        const snip = last.text.replace(/\s+/g, " ").trim().slice(0, 120);
        return { name: projectName(s.cwd), snip, at: s.lastSeenAt ? new Date(s.lastSeenAt).getTime() : 0 };
      })
      .filter(Boolean) as { name: string; snip: string; at: number }[];
    items.sort((a, b) => b.at - a.at);
    return items[0] ?? null;
  }, [sessions]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
        <span className="mono faint" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase" }}>Fleet activity</span>
      </div>
      <div style={{ position: "relative", flex: 1, overflow: "hidden", display: "flex", alignItems: "center" }}>
        {latest ? (
          <div key={`${latest.name}›${latest.snip}`} className="rcw-ticker-item mono"
            style={{ fontSize: 11.5, color: "var(--text-soft)", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
            <span style={{ color: "var(--text)" }}>{latest.name}</span> › {latest.snip}
          </div>
        ) : <span className="mono faint" style={{ fontSize: 11 }}>no fleet activity yet</span>}
      </div>
    </div>
  );
}

// ── Widget: Focus Timer ───────────────────────────────────────────────────────
const WORK = 25 * 60, BREAK = 5 * 60;
function FocusTimer() {
  const [mode, setMode] = useState<"work" | "break">("work");
  const [left, setLeft] = useState(WORK);
  const [running, setRunning] = useState(false);
  const [rounds, setRounds] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setLeft((v) => {
        if (v > 1) return v - 1;
        // Phase complete → flip work/break.
        setMode((mo) => {
          const next = mo === "work" ? "break" : "work";
          if (mo === "work") setRounds((r) => r + 1);
          setLeft(next === "work" ? WORK : BREAK);
          return next;
        });
        return 0;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [running]);
  const total = mode === "work" ? WORK : BREAK;
  const frac = 1 - left / total;
  const R = 30, C = 2 * Math.PI * R;
  const mm = Math.floor(left / 60), ss = left % 60;
  const reset = () => { setRunning(false); setMode("work"); setLeft(WORK); setRounds(0); };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", minHeight: 0, flex: 1, justifyContent: "center", gap: 6 }}>
      <div className="mono faint" style={{ fontSize: 8.5, letterSpacing: "0.18em", textTransform: "uppercase", color: mode === "work" ? "var(--text)" : "var(--text-soft)" }}>{mode === "work" ? "Focus" : "Break"}</div>
      <div style={{ position: "relative", width: 76, height: 76 }}>
        <svg width="76" height="76" viewBox="0 0 76 76" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="38" cy="38" r={R} fill="none" stroke="rgb(var(--primary-soft) / 0.15)" strokeWidth="3" />
          <circle cx="38" cy="38" r={R} fill="none" stroke="var(--text)" strokeWidth="3" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} style={{ transition: "stroke-dashoffset 0.9s linear" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 17, fontVariantNumeric: "tabular-nums" }}>{mm}:{String(ss).padStart(2, "0")}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={() => setRunning((r) => !r)} className="glass-btn--clay" style={{ padding: "3px 12px", fontSize: 11, fontWeight: 600 }}>{running ? "Pause" : "Start"}</button>
        <button onClick={reset} title="Reset" style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 7, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>↺</button>
        <span className="mono faint" style={{ fontSize: 10 }}>#{rounds}</span>
      </div>
    </div>
  );
}

// ── Widget: Scratch Note ──────────────────────────────────────────────────────
function ScratchNote({ text, onChange }: { text: string; onChange: (t: string) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div className="mono faint" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 5 }}>✎ Scratch</div>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder="quick notes…"
        spellCheck={false}
        className="no-scrollbar"
        style={{ flex: 1, minHeight: 0, resize: "none", border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 12, lineHeight: 1.5, fontFamily: "var(--font-mono)" }}
      />
    </div>
  );
}

// ── Widget: Recon Radar ───────────────────────────────────────────────────────
type Peer = { ip: string; port: number | null; count: number };
// Stable hash → [0,1) for deterministic blip placement per IP.
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
function ReconRadar() {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const machine = useMemo(() => {
    const s = [...sessions, ...queue].find((x) => x.id === focusId);
    return s?.machine ?? null;
  }, [focusId, sessions, queue]);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [hover, setHover] = useState<Peer | null>(null);
  const openIp = useStore((s) => s.openIpInspect);

  useEffect(() => {
    if (!machine) { setPeers([]); return; }
    let alive = true;
    const load = () => {
      window.cowork.hostConnections(machine).then((p) => { if (alive) setPeers(p); }).catch(() => { if (alive) setPeers([]); });
    };
    load();
    const id = setInterval(load, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [machine]);

  const blips = useMemo(() => peers.map((p) => {
    const a = hash01(p.ip) * Math.PI * 2;
    const r = 0.34 + hash01(p.ip + "r") * 0.6; // 0.34..0.94 of radius
    const x = 50 + Math.cos(a) * r * 46, y = 50 + Math.sin(a) * r * 46;
    // Screen angle of this blip (0deg = north, clockwise). The sweep's bright edge sits at
    // screen angle = the sweep's current rotation, so a blip is "under the sweep" when the
    // rotation is near phi — the shared-clock loop below lights it exactly then.
    const phi = (Math.atan2(x - 50, -(y - 50)) * 180 / Math.PI + 360) % 360;
    return { p, x, y, phi };
  }), [peers]);

  // ONE clock drives both the cone rotation AND every blip's glow, so they can never drift
  // apart (the previous two-independent-CSS-animations approach kept mis-phasing). Each frame
  // we rotate the sweep and light each blip by how close the bright edge is to its angle.
  const sweepRef = useRef<HTMLSpanElement>(null);
  const glowRefs = useRef<Map<string, HTMLSpanElement>>(new Map());
  const blipsRef = useRef(blips);
  blipsRef.current = blips;
  useEffect(() => {
    let raf = 0, start = 0;
    const DUR = 4200, WEDGE = 42; // ms per revolution; deg half-window the glow spans
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || document.body.classList.contains("rcw-hidden")) return;
      if (!start) start = ts;
      const angle = -(((ts - start) / DUR) * 360) % 360; // reversed (counter-clockwise) sweep
      if (sweepRef.current) sweepRef.current.style.transform = `rotate(${angle}deg)`;
      for (const b of blipsRef.current) {
        const el = glowRefs.current.get(b.p.ip);
        if (!el) continue;
        const diff = (((angle - b.phi) % 360) + 540) % 360 - 180; // signed shortest [-180,180]
        const inten = Math.max(0, 1 - Math.abs(diff) / WEDGE);
        if (inten <= 0.02) { if (el.style.opacity !== "0") el.style.opacity = "0"; continue; }
        // Preview's contact pulse: a small ring that blooms to ~9px and fades —
        // the dot lights up as the sweep crosses it, it never becomes a blob.
        const sz = 5 + inten * 5;
        el.style.opacity = (inten * 0.85).toFixed(3);
        el.style.width = el.style.height = sz.toFixed(1) + "px";
        el.style.boxShadow = `0 0 0 ${(inten * 4).toFixed(1)}px rgba(230,59,46,${(inten * 0.28).toFixed(2)})`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-soft)" }}>Recon</span>
        <span className="mono faint" style={{ fontSize: 9.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{machine ?? "no host"}</span>
        <span style={{ flex: 1 }} />
        <span className="mono faint" style={{ fontSize: 9.5 }}>{peers.length} peer{peers.length === 1 ? "" : "s"}</span>
      </div>
      <div style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div className="rcw-radar" style={{ position: "relative", width: "100%", maxWidth: 180, aspectRatio: "1 / 1" }}>
          {/* rings */}
          {[1, 0.66, 0.33].map((f, i) => (
            <span key={i} className="rcw-round" style={{ position: "absolute", inset: `${(1 - f) * 50}%`, border: "1px solid rgba(232,230,225,0.13)" }} />
          ))}
          <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgba(232,230,225,0.08)" }} />
          <span style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgba(232,230,225,0.08)" }} />
          {/* sweep (rotation driven by the shared clock above) */}
          <span ref={sweepRef} className="rcw-radar-sweep" />
          {/* blips: the shared-clock loop lights each glow as the sweep's bright edge crosses
              its angle; click opens the IP inspector (same modal as the network map) */}
          {blips.map((b) => {
            // Preview spec: a contact is a 5px dot — never sized by traffic.
            // Red marks a repeat connection; a one-off sits quiet in dim chalk.
            const d = 5;
            const live = b.p.count > 1;
            return (
              <span key={b.p.ip} style={{ position: "absolute", left: `${b.x}%`, top: `${b.y}%` }}>
                <span
                  ref={(el) => { if (el) glowRefs.current.set(b.p.ip, el); else glowRefs.current.delete(b.p.ip); }}
                  className="rcw-blip-glow" />
                <span
                  onClick={() => openIp({ ip: b.p.ip, port: b.p.port })}
                  onMouseEnter={() => setHover(b.p)} onMouseLeave={() => setHover((h) => (h?.ip === b.p.ip ? null : h))}
                  title={`${b.p.ip}${b.p.port ? " :" + b.p.port : ""} · ×${b.p.count} — click to inspect`}
                  className={`rcw-blip${live ? "" : " ok"}`}
                  style={{ position: "absolute", left: 0, top: 0, width: d, height: d }} />
              </span>
            );
          })}
        </div>
        {peers.length === 0 && <div className="mono faint" style={{ position: "absolute", fontSize: 10 }}>{machine ? "no external peers" : "focus a session"}</div>}
        {hover && (
          <div className="mono" style={{ position: "absolute", bottom: 2, left: 2, right: 2, textAlign: "center", fontSize: 10.5, color: "var(--text)", background: "color-mix(in srgb, var(--app-panel) 88%, transparent)", borderRadius: 6, padding: "2px 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {hover.ip}{hover.port ? ` :${hover.port}` : ""} · ×{hover.count}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Widget: Reactor (top processes on the remote host) ────────────────────────
type Proc = { pid: number; name: string; cpu: number; mem: number };
// Load colour: chalk (idle) → soft chalk (busy) → signal red only when pegged.
function loadColor(pct: number): string {
  if (pct >= 300) return "#e63b2e"; /* multi-core values run past 100% routinely */
  if (pct >= 100) return "var(--text)";
  return "var(--text-soft)";
}
function Reactor() {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const machine = useMemo(() => [...sessions, ...queue].find((x) => x.id === focusId)?.machine ?? null, [focusId, sessions, queue]);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [usage, setUsage] = useState<{ cpuPct: number; memPct: number }>({ cpuPct: 0, memPct: 0 });
  const [by, setBy] = useState<"cpu" | "mem">("cpu");

  useEffect(() => {
    if (!machine) { setProcs([]); setUsage({ cpuPct: 0, memPct: 0 }); return; }
    let alive = true;
    const load = () => {
      window.cowork.hostProcesses(machine)
        .then((r) => { if (alive) { setProcs(r.procs); setUsage({ cpuPct: r.cpuPct, memPct: r.memPct }); } })
        .catch(() => { if (alive) { setProcs([]); setUsage({ cpuPct: 0, memPct: 0 }); } });
    };
    load();
    const id = setInterval(load, 3500);
    return () => { alive = false; clearInterval(id); };
  }, [machine]);

  const rows = useMemo(() => [...procs].sort((a, b) => (by === "cpu" ? b.cpu - a.cpu : b.mem - a.mem)).slice(0, 8), [procs, by]);
  const tabBtn = (k: "cpu" | "mem") => ({
    border: "none", cursor: "pointer", padding: "1px 7px", fontSize: 9.5, borderRadius: 6,
    fontFamily: "var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase" as const,
    background: by === k ? "rgba(232,230,225,0.26)" : "transparent", color: by === k ? "var(--text)" : "var(--text-soft)",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-soft)" }}>Reactor</span>
        <span className="mono faint" style={{ fontSize: 9.5, minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{machine ?? "no host"}</span>
        <div style={{ display: "inline-flex", gap: 2, border: "1px solid var(--border)", borderRadius: 7, padding: 1 }}>
          <button style={tabBtn("cpu")} onClick={() => setBy("cpu")}>cpu</button>
          <button style={tabBtn("mem")} onClick={() => setBy("mem")}>mem</button>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="mono faint" style={{ fontSize: 11, margin: "auto" }}>{machine ? "reading…" : "focus a session"}</div>
      ) : (
        <ReactorDonut rows={rows.slice(0, 5)} metric={by} overall={by === "cpu" ? usage.cpuPct : usage.memPct} />
      )}
    </div>
  );
}


/** Segmented donut of the top 5 processes (the approved Signal Room reactor):
 *  arcs morph and values count smoothly, leader-line callouts on both sides,
 *  a slowly rotating dotted inner ring + crosshair. Red only when pegged. */
function ReactorDonut({ rows, metric, overall }: { rows: Proc[]; metric: "cpu" | "mem"; overall: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const state = useRef<{ items: { name: string; v: number; s: number }[]; rot: number }>({ items: [], rot: 0 });
  const data = useRef(rows);
  const met = useRef(metric);
  const over = useRef(overall);
  data.current = rows; met.current = metric; over.current = overall;
  useEffect(() => {
    const el = cv.current!;
    let raf = 0, last = 0;
    const RAMP = ["#e8e6e1", "#b5b2ab", "#98958f", "#6e6b66", "#4a4844"];
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 33 || document.hidden) return;
      last = t;
      const box = wrap.current!;
      const w = box.clientWidth * 2, h = box.clientHeight * 2;
      if (el.width !== w || el.height !== h) { el.width = w; el.height = h; }
      const g = el.getContext("2d")!;
      const st = state.current;
      const live = data.current.map((p) => ({ name: p.name, v: met.current === "cpu" ? p.cpu : p.mem }));
      // reconcile animated items with live rows
      st.items = live.map((lv) => {
        const prev = st.items.find((i) => i.name === lv.name);
        return prev ? { name: lv.name, v: prev.v + (lv.v - prev.v) * 0.08, s: prev.s } : { name: lv.name, v: lv.v, s: 0 };
      });
      const total = Math.max(1, st.items.reduce((a, i) => a + i.v, 0));
      const GAP = 0.07;
      st.items.forEach((i) => {
        const target = (i.v / total) * (Math.PI * 2 - GAP * st.items.length);
        i.s += (target - i.s) * 0.08;
      });
      st.rot += 0.0015;
      const cx = w / 2, cy = h / 2 + 4, R = Math.min(h * 0.34, w * 0.2);
      g.clearRect(0, 0, w, h);
      g.fillStyle = "rgba(232,230,225,.3)";
      for (let d = 0; d < 60; d++) {
        const da = (d / 60) * Math.PI * 2 + st.rot;
        g.fillRect(cx + Math.cos(da) * R * 0.72 - 1, cy + Math.sin(da) * R * 0.72 - 1, 2, 2);
      }
      // Centre readout = OVERALL host usage for the active tab (CPU normalised by cores,
      // RAM = real memory used) — a meaningful whole-box number, unlike the per-process rows.
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = over.current >= 90 ? "#e63b2e" : "#e8e6e1";
      g.font = '700 28px "SFU Futura", "IBM Plex Mono", monospace';
      g.fillText(Math.round(over.current) + "%", cx, cy - 3);
      g.fillStyle = "#8a8781";
      g.font = '600 9px "IBM Plex Mono", monospace';
      g.fillText(met.current === "cpu" ? "CPU LOAD" : "RAM USED", cx, cy + 16);
      g.textBaseline = "alphabetic";
      let a = -Math.PI / 2;
      const sides: { l: { i: number; mid: number }[]; r: { i: number; mid: number }[] } = { l: [], r: [] };
      st.items.forEach((item, i) => {
        const pegged = i === 0 && item.v >= 300;
        g.strokeStyle = pegged ? "#e63b2e" : RAMP[i] ?? "#4a4844";
        g.lineWidth = 6; g.lineCap = "butt";
        g.beginPath(); g.arc(cx, cy, R, a, a + item.s); g.stroke();
        const mid = a + item.s / 2;
        sides[Math.cos(mid) >= 0 ? "r" : "l"].push({ i, mid });
        a += item.s + GAP;
      });
      (["l", "r"] as const).forEach((sd) => {
        const arr = sides[sd].sort((x, y) => Math.sin(x.mid) - Math.sin(y.mid));
        arr.forEach((e, k) => {
          const dir = sd === "r" ? 1 : -1;
          const item = st.items[e.i];
          const pegged = e.i === 0 && item.v >= 300;
          const px = cx + Math.cos(e.mid) * (R + 5), py = cy + Math.sin(e.mid) * (R + 5);
          const ly = cy + (k - (arr.length - 1) / 2) * 52;
          const lx = cx + dir * (R + 40);
          g.strokeStyle = "rgba(232,230,225,.25)"; g.lineWidth = 1;
          g.beginPath(); g.moveTo(px, py); g.lineTo(lx - dir * 12, ly); g.lineTo(lx, ly); g.stroke();
          g.textAlign = dir > 0 ? "left" : "right";
          g.fillStyle = "#98958f";
          g.font = '16px "IBM Plex Mono", monospace';
          g.fillText(item.name.slice(0, 14), lx + dir * 6, ly - 4);
          g.fillStyle = pegged ? "#e63b2e" : (RAMP[e.i] ?? "#4a4844");
          g.font = '700 20px "SFU Futura", "IBM Plex Mono", monospace';
          g.fillText(Math.round(item.v) + "%", lx + dir * 6, ly + 16);
        });
      });
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={wrap} style={{ flex: 1, minHeight: 0, position: "relative" }}>
      <canvas ref={cv} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
    </div>
  );
}

// ── Widget: Agenda (macOS system calendar) ────────────────────────────────────
type CalEvent = { title: string; start: string; end: string; allDay: boolean; calendar: string };
// Stable per-calendar shade (chalk monochrome) so each account still reads distinct.
const CAL_HUES = ["#e8e6e1", "#98958f", "#c4c1bb", "#b0ada7", "#d6d3cd", "#8a8781", "#a8a59f"];
function calColor(name: string): string { return CAL_HUES[Math.floor(hash01(name) * CAL_HUES.length) % CAL_HUES.length]; }
function dayLabel(d: Date, now: Date): string {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((a.getTime() - b.getTime()) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}
function hhmm(d: Date): string { return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }

function Agenda() {
  const [state, setState] = useState<{ ok: boolean; denied: boolean; events: CalEvent[] } | null>(null);
  const now = useNow(60_000); // re-render each minute so "now" / past-dimming stays fresh

  useEffect(() => {
    let alive = true;
    const load = () => { window.cowork.calendarEvents().then((r) => { if (alive) setState(r); }).catch(() => { if (alive) setState({ ok: false, denied: false, events: [] }); }); };
    load();
    const id = setInterval(load, 5 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Group upcoming (not-yet-ended) events by day.
  const groups = useMemo(() => {
    if (!state) return [];
    const nd = new Date(now);
    const evs = state.events
      .map((e) => ({ e, s: new Date(e.start), end: e.end ? new Date(e.end) : new Date(e.start) }))
      .filter((x) => x.end.getTime() >= nd.getTime() - 60_000)
      .sort((a, b) => a.s.getTime() - b.s.getTime());
    const by = new Map<string, { label: string; items: typeof evs }>();
    for (const x of evs) {
      const key = new Date(x.s.getFullYear(), x.s.getMonth(), x.s.getDate()).toDateString();
      if (!by.has(key)) by.set(key, { label: dayLabel(x.s, nd), items: [] });
      by.get(key)!.items.push(x);
    }
    return [...by.values()];
  }, [state, now]);

  const nextStart = groups[0]?.items[0]?.s.getTime() ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
        <span style={{ fontSize: 12 }}>▦</span>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)" }}>Agenda</span>
        <span style={{ flex: 1 }} />
        {nextStart && <span className="mono faint" style={{ fontSize: 9.5 }}>next {hhmm(new Date(nextStart))}</span>}
      </div>
      {!state ? (
        <div className="mono faint" style={{ fontSize: 11, margin: "auto" }}>reading calendar…</div>
      ) : state.denied ? (
        <div className="mono faint" style={{ fontSize: 10.5, margin: "auto", textAlign: "center", lineHeight: 1.5 }}>Calendar access denied.<br />Grant it in System Settings ›<br />Privacy › Calendars.</div>
      ) : !state.ok ? (
        <div className="mono faint" style={{ fontSize: 10.5, margin: "auto", textAlign: "center" }}>calendar unavailable<br />(macOS only)</div>
      ) : groups.length === 0 ? (
        <div className="mono faint" style={{ fontSize: 11, margin: "auto" }}>◇ nothing scheduled</div>
      ) : (
        <div className="no-scrollbar" style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", minHeight: 0 }}>
          {groups.map((g) => (
            <div key={g.label}>
              <div className="mono faint" style={{ fontSize: 8.5, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 4 }}>{g.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {g.items.map((x, i) => {
                  const soon = x.s.getTime() === nextStart;
                  return (
                    <div key={i} title={`${x.e.title}\n${x.e.calendar}`} style={{ display: "flex", alignItems: "baseline", gap: 7, opacity: soon ? 1 : 0.92 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, alignSelf: "center", background: calColor(x.e.calendar) }} />
                      <span className="mono" style={{ fontSize: 10, flexShrink: 0, color: soon ? "rgb(var(--accent))" : "var(--text-soft)", fontVariantNumeric: "tabular-nums", minWidth: 46 }}>
                        {x.e.allDay ? "all-day" : hhmm(x.s)}
                      </span>
                      <span style={{ fontSize: 11.5, minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.e.title}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
function WidgetStyles() {
  return (
    <style>{`
      .rcw-widget { border-radius: 14px; background: color-mix(in srgb, var(--app-panel) 82%, transparent);
        border: 1px solid var(--border); box-shadow: 0 10px 30px rgba(0,0,0,0.32); backdrop-filter: blur(7px); overflow: hidden; }
      .rcw-widget-grip { position: absolute; top: 0; left: 0; right: 0; height: 16px; display: flex; align-items: center; gap: 6px;
        padding: 0 8px; cursor: grab; z-index: 4; opacity: 0; transition: opacity .15s; }
      .rcw-widget-grip:active { cursor: grabbing; }
      .rcw-widget:hover .rcw-widget-grip { opacity: 1; }
      .rcw-widget-resize { position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize; z-index: 5; opacity: 0; transition: opacity .15s;
        background: rgb(var(--primary-soft) / 0.5); clip-path: polygon(100% 0, 100% 100%, 0 100%); border-bottom-right-radius: 13px; }
      .rcw-widget:hover .rcw-widget-resize { opacity: 1; }
      @keyframes rcw-ticker-in { from { opacity: 0; } to { opacity: 1; } }
      .rcw-ticker-item { animation: rcw-ticker-in .24s ease both; }
      @keyframes rcw-w-pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: 0.5; } }
      .rcw-w-pulse { animation: rcw-w-pulse 1.3s ease-in-out infinite; }
      /* The sweep's rotation is driven by the shared-clock loop (JS), not a CSS animation,
         so the blip glows stay perfectly in phase with it. */
      .rcw-radar-sweep { position: absolute; inset: 0; clip-path: circle(50%);
        background: conic-gradient(from 0deg, rgba(230,59,46,0.28), rgba(230,59,46,0.04) 52deg, transparent 60deg); }
      /* Contacts: round dots at a fixed 5px (redesign-hud-preview.html). Red = a
         repeat connection, dim chalk = a single-hit peer. */
      .rcw-blip { border-radius: 50% !important; background: #e63b2e; transform: translate(-50%, -50%);
        cursor: pointer; transition: background .15s ease; }
      .rcw-blip.ok { background: var(--text-soft); }
      .rcw-blip:hover { background: var(--text); }
      /* Contact glow: opacity/size/shadow are set each frame by the shared clock so a blip is
         brightest exactly when the sweep's bright edge is on it, fading either side. */
      .rcw-blip-glow { position: absolute; left: 0; top: 0; width: 5px; height: 5px; border-radius: 50%;
        background: rgba(230,59,46,.45); transform: translate(-50%, -50%); pointer-events: none; opacity: 0; }
      body.rcw-hidden .rcw-w-pulse { animation-play-state: paused !important; }
    `}</style>
  );
}
