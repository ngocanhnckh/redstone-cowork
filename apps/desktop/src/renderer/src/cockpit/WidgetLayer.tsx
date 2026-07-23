import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";

// A free-floating widget canvas over the HUD desktop (behind the app windows). Widgets
// are draggable/resizable, glanceable, and persist their placement globally. Every
// widget here is NEW — none duplicate the fixed telemetry deck or the left column.

export type WidgetKind = "attention" | "burn" | "ticker" | "timer" | "scratch" | "throughput" | "radar" | "reactor" | "agenda";
export type WidgetInst = { id: string; kind: WidgetKind; x: number; y: number; w: number; h: number; text?: string };

const KEY = "rcw.widgets";

type Meta = { label: string; icon: string; w: number; h: number; minW: number; minH: number };
const CATALOG: Record<WidgetKind, Meta> = {
  attention:  { label: "Attention Radar", icon: "◉", w: 260, h: 158, minW: 200, minH: 120 },
  burn:       { label: "Fleet Burn ($)",  icon: "$", w: 210, h: 132, minW: 170, minH: 110 },
  ticker:     { label: "Activity Ticker", icon: "⚡", w: 340, h: 74,  minW: 220, minH: 60  },
  timer:      { label: "Focus Timer",     icon: "◔", w: 196, h: 150, minW: 170, minH: 130 },
  scratch:    { label: "Scratch Note",    icon: "✎", w: 224, h: 158, minW: 160, minH: 110 },
  throughput: { label: "Throughput",      icon: "▚", w: 224, h: 128, minW: 180, minH: 108 },
  radar:      { label: "Recon Radar",     icon: "◎", w: 244, h: 244, minW: 190, minH: 190 },
  reactor:    { label: "Top Processes",   icon: "⚛", w: 264, h: 190, minW: 210, minH: 140 },
  agenda:     { label: "Agenda",          icon: "▦", w: 286, h: 214, minW: 220, minH: 150 },
};
const ORDER: WidgetKind[] = ["attention", "agenda", "reactor", "radar", "burn", "throughput", "ticker", "timer", "scratch"];

function loadWidgets(): WidgetInst[] | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return null; // never initialised → caller seeds defaults
    const p = JSON.parse(raw);
    if (!Array.isArray(p)) return [];
    return p.filter((w) => w && typeof w.id === "string" && CATALOG[w.kind as WidgetKind]);
  } catch {
    return [];
  }
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
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgb(var(--primary) / 0.16)")}
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

// Sample fleet-wide totals (tokens + $) on an interval and expose recent per-interval
// deltas → live tok/min, $/hr and sparklines. Shared by Fleet Burn + Throughput.
function useFleetSamples(): { totalTok: number; totalCost: number; tokPerMin: number; costPerHr: number; tokSpark: number[]; costSpark: number[] } {
  const sessions = useStore((s) => s.sessions);
  const totals = useMemo(() => {
    let tok = 0, cost = 0;
    for (const s of sessions) {
      tok += (s.tokensInput ?? 0) + (s.tokensOutput ?? 0);
      const r = modelRate(s.model);
      cost += (s.tokensInput ?? 0) / 1e6 * r.in + (s.tokensOutput ?? 0) / 1e6 * r.out;
    }
    return { tok, cost };
  }, [sessions]);

  // Ring of timestamped samples; a new one is captured every SAMPLE_MS.
  const SAMPLE_MS = 5000, MAX = 24;
  const [ring, setRing] = useState<{ t: number; tok: number; cost: number }[]>(() => [{ t: Date.now(), tok: totals.tok, cost: totals.cost }]);
  const totalsRef = useRef(totals); totalsRef.current = totals;
  useEffect(() => {
    const id = setInterval(() => {
      setRing((r) => [...r, { t: Date.now(), tok: totalsRef.current.tok, cost: totalsRef.current.cost }].slice(-MAX));
    }, SAMPLE_MS);
    return () => clearInterval(id);
  }, []);

  const { tokPerMin, costPerHr, tokSpark, costSpark } = useMemo(() => {
    const tSpark: number[] = [], cSpark: number[] = [];
    for (let i = 1; i < ring.length; i++) {
      const dt = (ring[i].t - ring[i - 1].t) / 1000; // seconds
      if (dt <= 0) continue;
      tSpark.push(Math.max(0, (ring[i].tok - ring[i - 1].tok)) / dt * 60);       // tok/min this interval
      cSpark.push(Math.max(0, (ring[i].cost - ring[i - 1].cost)) / dt * 3600);   // $/hr this interval
    }
    const oldest = ring[0], newest = ring[ring.length - 1];
    const span = Math.max(1, (newest.t - oldest.t) / 1000);
    return {
      tokPerMin: Math.max(0, (newest.tok - oldest.tok)) / span * 60,
      costPerHr: Math.max(0, (newest.cost - oldest.cost)) / span * 3600,
      tokSpark: tSpark, costSpark: cSpark,
    };
  }, [ring]);

  return { totalTok: totals.tok, totalCost: totals.cost, tokPerMin, costPerHr, tokSpark, costSpark };
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
        <span className={rows.length ? "rcw-w-pulse" : ""} style={{ width: 8, height: 8, borderRadius: "50%", background: rows.length ? "rgb(var(--accent))" : "var(--text-faint)", boxShadow: rows.length ? "0 0 10px 1px rgb(var(--accent))" : "none" }} />
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
                <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: hot ? "#ff7a6b" : "rgb(var(--accent))", boxShadow: `0 0 8px 1px ${hot ? "#ff7a6b" : "rgb(var(--accent))"}`, animation: `rcw-w-blink ${hot ? 0.7 : 1.6}s steps(1) infinite` }} />
                <span style={{ fontSize: 12, minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                <span className="mono faint" style={{ fontSize: 10, flexShrink: 0 }}>{r.kind[0].toUpperCase()}</span>
                <span className="mono" style={{ fontSize: 10.5, flexShrink: 0, color: hot ? "#ff9b8f" : "var(--text-soft)", fontVariantNumeric: "tabular-nums" }}>{fmtAge(r.age)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Widget: Fleet Burn ($) ────────────────────────────────────────────────────
function FleetBurn() {
  const { totalCost, costPerHr, costSpark } = useFleetSamples();
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      {kicker("Fleet burn")}
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 24, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}>${totalCost.toFixed(2)}</span>
        <span className="mono faint" style={{ fontSize: 10 }}>total</span>
      </div>
      <div className="mono" style={{ fontSize: 11.5, color: "rgb(var(--accent))", marginTop: 2, marginBottom: 6 }}>${costPerHr.toFixed(2)} <span className="faint">/hr</span></div>
      <div style={{ marginTop: "auto" }}><Spark data={costSpark} color="rgb(var(--accent))" height={26} /></div>
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
function ActivityTicker() {
  const sessions = useStore((s) => s.sessions);
  const text = useMemo(() => {
    const items = sessions
      .map((s) => {
        const last = [...(s.transcript ?? [])].reverse().find((m) => m.role === "assistant");
        if (!last) return null;
        const snip = last.text.replace(/\s+/g, " ").trim().slice(0, 80);
        return { name: projectName(s.cwd), snip, at: s.lastSeenAt ? new Date(s.lastSeenAt).getTime() : 0 };
      })
      .filter(Boolean) as { name: string; snip: string; at: number }[];
    items.sort((a, b) => b.at - a.at);
    return items.map((i) => `${i.name} › ${i.snip}`).join("     •     ");
  }, [sessions]);

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 5 }}>
        <span style={{ color: "rgb(var(--accent))", fontSize: 12 }}>⚡</span>
        <span className="mono faint" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase" }}>Fleet activity</span>
      </div>
      <div style={{ position: "relative", flex: 1, overflow: "hidden", display: "flex", alignItems: "center", maskImage: "linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent)" }}>
        {text ? (
          <div className="rcw-marquee mono" style={{ fontSize: 11.5, color: "var(--text-soft)", whiteSpace: "nowrap" }}>
            <span>{text}</span><span style={{ paddingLeft: 60 }}>{text}</span>
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
      <div className="mono faint" style={{ fontSize: 8.5, letterSpacing: "0.18em", textTransform: "uppercase", color: mode === "work" ? "rgb(var(--accent))" : "rgb(var(--primary-soft))" }}>{mode === "work" ? "Focus" : "Break"}</div>
      <div style={{ position: "relative", width: 76, height: 76 }}>
        <svg width="76" height="76" viewBox="0 0 76 76" style={{ transform: "rotate(-90deg)" }}>
          <circle cx="38" cy="38" r={R} fill="none" stroke="rgb(var(--primary-soft) / 0.15)" strokeWidth="3" />
          <circle cx="38" cy="38" r={R} fill="none" stroke="rgb(var(--accent))" strokeWidth="3" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - frac)} style={{ transition: "stroke-dashoffset 0.9s linear", filter: "drop-shadow(0 0 4px rgb(var(--accent) / 0.6))" }} />
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
    return { p, x: 50 + Math.cos(a) * r * 46, y: 50 + Math.sin(a) * r * 46 };
  }), [peers]);

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
            <span key={i} style={{ position: "absolute", inset: `${(1 - f) * 50}%`, borderRadius: "50%", border: "1px solid rgb(var(--primary-soft) / 0.16)" }} />
          ))}
          <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "rgb(var(--primary-soft) / 0.12)" }} />
          <span style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "rgb(var(--primary-soft) / 0.12)" }} />
          {/* sweep */}
          <span className="rcw-radar-sweep" />
          {/* center */}
          <span style={{ position: "absolute", left: "calc(50% - 3px)", top: "calc(50% - 3px)", width: 6, height: 6, borderRadius: "50%", background: "rgb(var(--accent))", boxShadow: "0 0 8px 1px rgb(var(--accent))" }} />
          {/* blips */}
          {blips.map((b) => (
            <span key={b.p.ip}
              onMouseEnter={() => setHover(b.p)} onMouseLeave={() => setHover((h) => (h?.ip === b.p.ip ? null : h))}
              title={`${b.p.ip}${b.p.port ? " :" + b.p.port : ""} · ×${b.p.count}`}
              className="rcw-blip"
              style={{ position: "absolute", left: `${b.x}%`, top: `${b.y}%`, width: Math.min(11, 5 + b.p.count), height: Math.min(11, 5 + b.p.count) }} />
          ))}
        </div>
        {peers.length === 0 && <div className="mono faint" style={{ position: "absolute", fontSize: 10 }}>{machine ? "no external peers" : "focus a session"}</div>}
        {hover && (
          <div className="mono" style={{ position: "absolute", bottom: 2, left: 2, right: 2, textAlign: "center", fontSize: 10.5, color: "rgb(var(--accent))", background: "color-mix(in srgb, var(--app-panel) 88%, transparent)", borderRadius: 6, padding: "2px 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {hover.ip}{hover.port ? ` :${hover.port}` : ""} · ×{hover.count}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Widget: Reactor (top processes on the remote host) ────────────────────────
type Proc = { pid: number; name: string; cpu: number; mem: number };
// A hot→cold colour for a load percentage: cyan (idle) → amber → red (pegged).
function loadColor(pct: number): string {
  if (pct >= 80) return "#ff5c4d";
  if (pct >= 45) return "#ffb454";
  return "rgb(var(--accent))";
}
function Reactor() {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const machine = useMemo(() => [...sessions, ...queue].find((x) => x.id === focusId)?.machine ?? null, [focusId, sessions, queue]);
  const [procs, setProcs] = useState<Proc[]>([]);
  const [by, setBy] = useState<"cpu" | "mem">("cpu");

  useEffect(() => {
    if (!machine) { setProcs([]); return; }
    let alive = true;
    const load = () => { window.cowork.hostProcesses(machine).then((p) => { if (alive) setProcs(p); }).catch(() => { if (alive) setProcs([]); }); };
    load();
    const id = setInterval(load, 3500);
    return () => { alive = false; clearInterval(id); };
  }, [machine]);

  const rows = useMemo(() => [...procs].sort((a, b) => (by === "cpu" ? b.cpu - a.cpu : b.mem - a.mem)).slice(0, 8), [procs, by]);
  const tabBtn = (k: "cpu" | "mem") => ({
    border: "none", cursor: "pointer", padding: "1px 7px", fontSize: 9.5, borderRadius: 6,
    fontFamily: "var(--font-mono)", letterSpacing: "0.06em", textTransform: "uppercase" as const,
    background: by === k ? "rgb(var(--primary) / 0.26)" : "transparent", color: by === k ? "var(--text)" : "var(--text-soft)",
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
        <div className="no-scrollbar" style={{ display: "flex", flexDirection: "column", gap: 4, overflowY: "auto", minHeight: 0 }}>
          {rows.map((p, i) => {
            const v = by === "cpu" ? p.cpu : p.mem;
            const c = loadColor(v);
            const hot = i === 0 && v >= 80;
            return (
              <div key={p.pid} title={`pid ${p.pid} · ${p.name} · cpu ${p.cpu}% · mem ${p.mem}%`} style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, height: 17 }}>
                {/* load bar behind the label */}
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.min(100, v)}%`, background: `linear-gradient(90deg, ${c}44, ${c}14)`, borderLeft: `2px solid ${c}`, borderRadius: 3, boxShadow: hot ? `0 0 10px ${c}` : "none", transition: "width .6s ease", animation: hot ? "rcw-w-pulse 1s ease-in-out infinite" : "none" }} />
                <span style={{ position: "relative", fontSize: 11.5, minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: 6 }}>{p.name}</span>
                <span className="mono faint" style={{ position: "relative", fontSize: 8.5 }}>{p.pid}</span>
                <span className="mono" style={{ position: "relative", fontSize: 11, color: c, fontVariantNumeric: "tabular-nums", minWidth: 38, textAlign: "right" }}>{v.toFixed(1)}%</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Widget: Agenda (macOS system calendar) ────────────────────────────────────
type CalEvent = { title: string; start: string; end: string; allDay: boolean; calendar: string };
// Stable per-calendar accent so each account reads as its own colour dot.
const CAL_HUES = ["#54e6ff", "#7ee081", "#ffb454", "#c78bff", "#ff8fa3", "#6fb8ff", "#f0d264"];
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
                      <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, alignSelf: "center", background: calColor(x.e.calendar), boxShadow: soon ? `0 0 8px 1px ${calColor(x.e.calendar)}` : "none" }} />
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
        background: linear-gradient(135deg, transparent 50%, rgb(var(--primary-soft) / 0.5) 50%); border-bottom-right-radius: 13px; }
      .rcw-widget:hover .rcw-widget-resize { opacity: 1; }
      @keyframes rcw-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
      .rcw-marquee { display: inline-flex; animation: rcw-marquee 26s linear infinite; }
      .rcw-marquee:hover { animation-play-state: paused; }
      @keyframes rcw-w-blink { 50% { opacity: 0.25; } }
      @keyframes rcw-w-pulse { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.5); opacity: 0.5; } }
      .rcw-w-pulse { animation: rcw-w-pulse 1.3s ease-in-out infinite; }
      @keyframes rcw-radar-spin { to { transform: rotate(360deg); } }
      .rcw-radar-sweep { position: absolute; inset: 0; border-radius: 50%; animation: rcw-radar-spin 3.4s linear infinite;
        background: conic-gradient(from 0deg, transparent 0deg, rgb(var(--accent) / 0.02) 300deg, rgb(var(--accent) / 0.28) 355deg, rgb(var(--accent) / 0.5) 360deg); }
      .rcw-blip { border-radius: 50%; background: rgb(var(--accent)); box-shadow: 0 0 7px 1px rgb(var(--accent)); transform: translate(-50%, -50%);
        cursor: pointer; animation: rcw-w-pulse 2.4s ease-in-out infinite; }
      .rcw-blip:hover { background: #fff; box-shadow: 0 0 10px 2px rgb(var(--accent)); }
      body.rcw-hidden .rcw-marquee, body.rcw-hidden .rcw-radar-sweep, body.rcw-hidden .rcw-blip, body.rcw-hidden .rcw-w-pulse { animation-play-state: paused !important; }
    `}</style>
  );
}
