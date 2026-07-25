import { useEffect, useRef, useState } from "react";

/**
 * IDENTIFICATION SEQUENCE — the movie-style beat between clicking an Arena card
 * and the dossier opening: the database is searched, candidate faces jump past a
 * targeting reticle, the subject locks, and biometrics tick to 100% before the
 * frame hands off to the full record.
 *
 * Register rules: red is the scan/alert colour (this IS an alert state), corners
 * are hard, blinking belongs to the caret only — motion here is data movement
 * (rolling candidates, filling meters, streaming log lines).
 */

export type ScanSubject = { photo: string | null; name: string; username: string };

type Phase = "search" | "match" | "lock";

const LOG_LINES = [
  "OPENING PERSONNEL INDEX",
  "DECRYPTING BIOMETRIC VAULT",
  "CROSS-REFERENCING FIELD RECORDS",
  "RUNNING FACIAL GEOMETRY MATCH",
  "VERIFYING CLEARANCE SIGNATURE",
];

const BIOMETRICS = ["FACIAL GEOMETRY", "IRIS PATTERN", "GAIT SIGNATURE", "CLEARANCE HASH"];

export default function AgentIdentScan({
  subject,
  candidates,
  onDone,
}: {
  subject: ScanSubject;
  /** Other agents' photos, used as the rolling "database" frames. */
  candidates: Array<{ photo: string | null; username: string }>;
  onDone: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("search");
  const [frame, setFrame] = useState(0);
  const [progress, setProgress] = useState(0);
  const [logIdx, setLogIdx] = useState(0);
  const [bio, setBio] = useState<number[]>(() => BIOMETRICS.map(() => 0));
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const pool = candidates.filter((c) => c.photo && c.username !== subject.username);
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Master timeline: search (rolling faces) → match (lock + biometrics) → hand off.
  useEffect(() => {
    if (reduced) { doneRef.current(); return; }
    const timers = [
      setTimeout(() => setPhase("match"), 1250),
      setTimeout(() => setPhase("lock"), 2050),
      setTimeout(() => doneRef.current(), 2750),
    ];
    return () => timers.forEach(clearTimeout);
  }, [reduced]);

  // Rolling candidate faces — decelerating, like a slot landing on the subject.
  useEffect(() => {
    if (phase !== "search" || pool.length === 0) return;
    let n = 0;
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      n += 1;
      setFrame((f) => f + 1);
      id = setTimeout(tick, 55 + n * 7);
    };
    id = setTimeout(tick, 55);
    return () => clearTimeout(id);
  }, [phase, pool.length]);

  // Scan progress + log stepping.
  useEffect(() => {
    const id = setInterval(() => setProgress((p) => Math.min(100, p + 4)), 40);
    const lg = setInterval(() => setLogIdx((i) => Math.min(LOG_LINES.length - 1, i + 1)), 380);
    return () => { clearInterval(id); clearInterval(lg); };
  }, []);

  // Biometric meters fill once the face locks.
  useEffect(() => {
    if (phase === "search") return;
    const id = setInterval(() => {
      setBio((b) => b.map((v, i) => Math.min(100, v + 7 + i * 2)));
    }, 60);
    return () => clearInterval(id);
  }, [phase]);

  const shown = phase === "search" && pool.length > 0 ? pool[frame % pool.length].photo : subject.photo;
  const locked = phase !== "search";

  return (
    <div className="ais-wrap" role="status" aria-label="Identifying agent">
      <style>{CSS}</style>
      <div className="ais-frame">
        {/* header */}
        <div className="ais-hd">
          <span className="ais-dot" />
          <span className="ais-title">
            {phase === "search" ? "SEARCHING PERSONNEL DATABASE" : phase === "match" ? "FACIAL MATCH FOUND" : "IDENTITY CONFIRMED"}
          </span>
          <span className="ais-idx">{String(Math.min(99, Math.round(progress))).padStart(2, "0")}%</span>
        </div>

        {/* the face plate */}
        <div className={`ais-plate ${locked ? "lock" : ""}`}>
          {shown ? <img src={shown} alt="" className="ais-face" /> : <div className="ais-face ph" />}
          <span className="ais-scanline" />
          <span className="ais-grid" />
          {/* targeting reticle */}
          <span className="ais-ret tl" /><span className="ais-ret tr" />
          <span className="ais-ret bl" /><span className="ais-ret br" />
          {locked && <span className="ais-stamp">MATCH</span>}
          <span className="ais-cross" />
        </div>

        {/* readout */}
        <div className="ais-read">
          <div className="ais-name">{locked ? subject.name : "— — — —"}</div>
          <div className="ais-user">{locked ? `@${subject.username}` : "SCANNING…"}</div>
        </div>

        {/* biometrics */}
        <div className="ais-bio">
          {BIOMETRICS.map((b, i) => (
            <div className="ais-biorow" key={b}>
              <span className="ais-biok">{b}</span>
              <span className="ais-biobar"><i style={{ width: `${bio[i]}%` }} /></span>
              <span className="ais-biov">{bio[i] >= 100 ? "OK" : `${bio[i]}%`}</span>
            </div>
          ))}
        </div>

        {/* log */}
        <div className="ais-log">
          {LOG_LINES.slice(0, logIdx + 1).map((l, i) => (
            <div key={l} className="ais-logline">
              <span>▸ {l}</span>
              <b>{i < logIdx ? "OK" : "…"}</b>
            </div>
          ))}
        </div>

        <div className="ais-prog"><i style={{ width: `${progress}%` }} /></div>
      </div>
    </div>
  );
}

const CSS = `
.ais-wrap { position:fixed; inset:0; z-index:460; display:flex; align-items:center; justify-content:center;
  background: rgb(4 4 4 / .82); animation: ais-in .18s ease both; }
@keyframes ais-in { from { opacity:0; } }
@keyframes ais-out { to { opacity:0; transform:scale(1.04); } }
.ais-frame { width:360px; max-width:92vw; border:1px solid rgb(230 59 46 / .55); padding:14px 16px 16px;
  background: color-mix(in srgb, var(--app-panel) 88%, transparent); font-family:var(--font-mono);
  box-shadow: 0 24px 80px rgb(0 0 0 / .7); }
.ais-hd { display:flex; align-items:center; gap:8px; margin-bottom:12px; }
.ais-dot { width:6px; height:6px; background:#e63b2e; flex:none; }
.ais-title { font-size:9px; letter-spacing:.22em; text-transform:uppercase; color:#e63b2e; flex:1; }
.ais-idx { font-size:9px; letter-spacing:.12em; color:var(--text-soft); font-variant-numeric:tabular-nums; }
.ais-plate { position:relative; width:150px; height:150px; margin:0 auto 12px; overflow:hidden;
  border:1px solid var(--border-strong); background:#0a0a0a; }
.ais-face { width:100%; height:100%; object-fit:cover; display:block; filter:grayscale(1) contrast(1.15) brightness(.82); }
.ais-face.ph { background:repeating-linear-gradient(45deg, rgba(232,230,225,.06) 0 4px, transparent 4px 8px); }
.ais-plate.lock .ais-face { filter:grayscale(0) contrast(1.05) brightness(1); transition: filter .45s ease; }
.ais-grid { position:absolute; inset:0; pointer-events:none;
  background-image: linear-gradient(rgba(230,59,46,.09) 1px, transparent 1px), linear-gradient(90deg, rgba(230,59,46,.09) 1px, transparent 1px);
  background-size: 15px 15px; }
.ais-scanline { position:absolute; left:0; right:0; height:26px; pointer-events:none;
  background: linear-gradient(to bottom, transparent, rgba(230,59,46,.16) 76%, rgba(230,59,46,.9) 97%, transparent);
  animation: ais-scan 1.05s linear infinite; }
@keyframes ais-scan { from { transform: translateY(-26px); } to { transform: translateY(150px); } }
.ais-plate.lock .ais-scanline { opacity:0; transition:opacity .3s; }
.ais-ret { position:absolute; width:14px; height:14px; pointer-events:none; border-color:#e63b2e; }
.ais-ret.tl { top:5px; left:5px; border-top:1px solid; border-left:1px solid; }
.ais-ret.tr { top:5px; right:5px; border-top:1px solid; border-right:1px solid; }
.ais-ret.bl { bottom:5px; left:5px; border-bottom:1px solid; border-left:1px solid; }
.ais-ret.br { bottom:5px; right:5px; border-bottom:1px solid; border-right:1px solid; }
.ais-plate.lock .ais-ret { animation: ais-snap .3s cubic-bezier(.2,.9,.3,1) both; }
@keyframes ais-snap { from { transform: scale(1.9); opacity:.2; } to { transform:none; opacity:1; } }
.ais-cross { position:absolute; left:50%; top:50%; width:26px; height:26px; transform:translate(-50%,-50%); pointer-events:none;
  background: linear-gradient(#e63b2e,#e63b2e) center/1px 100% no-repeat, linear-gradient(#e63b2e,#e63b2e) center/100% 1px no-repeat;
  opacity:.35; }
.ais-plate.lock .ais-cross { opacity:0; transition:opacity .3s; }
.ais-stamp { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%);
  font-family:var(--font-display); font-weight:700; font-size:20px; letter-spacing:.3em; color:#e63b2e;
  border:2px solid #e63b2e; padding:3px 10px; background: rgb(10 10 10 / .55);
  animation: ais-stamp .34s cubic-bezier(.2,.9,.3,1) both; }
@keyframes ais-stamp { 0% { transform:translate(-50%,-50%) scale(2.2); opacity:0; } 60% { opacity:1; } 100% { transform:translate(-50%,-50%) scale(1); opacity:1; } }
.ais-read { text-align:center; margin-bottom:12px; }
.ais-name { font-family:var(--font-display); font-weight:700; font-size:15px; letter-spacing:.12em; text-transform:uppercase; color:var(--text); }
.ais-user { font-size:9px; letter-spacing:.14em; color:var(--text-faint); margin-top:2px; }
.ais-bio { display:flex; flex-direction:column; gap:4px; margin-bottom:10px; }
.ais-biorow { display:grid; grid-template-columns:96px 1fr 28px; gap:8px; align-items:center; }
.ais-biok { font-size:7.5px; letter-spacing:.14em; color:var(--text-faint); text-transform:uppercase; }
.ais-biobar { height:4px; border:1px solid var(--border); position:relative; }
.ais-biobar i { position:absolute; inset:0; right:auto; background:#e63b2e; transition:width .12s linear; }
.ais-biov { font-size:7.5px; color:var(--text-soft); text-align:right; font-variant-numeric:tabular-nums; }
.ais-log { border-top:1px solid var(--border); padding-top:8px; display:flex; flex-direction:column; gap:2px; min-height:62px; }
.ais-logline { display:flex; justify-content:space-between; gap:8px; font-size:8px; letter-spacing:.1em; color:var(--text-faint); }
.ais-logline b { color:var(--text-soft); font-weight:400; }
.ais-prog { margin-top:9px; height:2px; background:var(--border); position:relative; }
.ais-prog i { position:absolute; inset:0; right:auto; background:#e63b2e; transition:width .05s linear; }
`;
