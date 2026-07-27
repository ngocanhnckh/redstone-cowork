import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentWeekAward, AgentWeekEntry } from "../../../shared/scoring";
import { IconTrophy, IconGift, IconCrown } from "./Icons";

// Agent of the Week — a roster-wide weekly award. Each agent's EFFORT score (Σ Jira
// Original-Estimate hours of completed work − penalties, across their projects this week) is
// blended with a portion of their token spend, each scored against the roster's best, into
// one fair, comparable rating. Effort dominates so a big spender who ships nothing can't win.

const CSS = `
.aow-root { padding: 4px 20px 30px; }
.aow-head { display:flex; align-items:flex-end; gap:14px; flex-wrap:wrap; margin:6px 0 14px; }
.aow-head h2 { font-family:var(--font-display); font-size:24px; font-weight:800; letter-spacing:.02em; margin:0; color:var(--text); }
.aow-clock { margin-left:auto; text-align:right; }
.aow-clock .lbl { font-size:9px; letter-spacing:.22em; color:var(--text-faint); }
.aow-clock .val { font-family:var(--font-display); font-size:26px; font-weight:700; color:var(--text-soft); line-height:1.05; font-variant-numeric:tabular-nums; }
.aow-clock .val.ended { color:#e63b2e; }
.aow-prize { display:flex; align-items:center; gap:12px; padding:12px 16px; border-radius:14px; margin-bottom:16px;
  background:rgb(232 230 225 / .06); border:1px solid rgb(232 230 225 / .25); }
.aow-prize .tp { font-size:26px; }
.aow-prize .pl { font-size:9px; letter-spacing:.2em; color:var(--text-soft); opacity:.9; }
.aow-prize .pt { font-size:14px; color:var(--text); font-weight:600; margin-top:2px; }
.aow-weights { font-size:10.5px; letter-spacing:.06em; color:var(--text-faint); margin-bottom:14px; }
.aow-weights b { color:var(--text-soft); font-weight:600; }

.aow-spot { display:flex; gap:18px; align-items:center; padding:18px 20px; border-radius:18px; margin-bottom:16px;
  background:rgb(232 230 225 / .05); border:1.5px solid rgb(232 230 225 / .35); box-shadow:0 0 40px -14px rgb(232 230 225 / .35); }
.aow-spot .crown { position:absolute; font-size:20px; margin-top:-46px; margin-left:-4px; }
.aow-photo { width:104px; height:104px; border-radius:16px; object-fit:cover; border:2px solid rgb(232 230 225 / .7); box-shadow:0 0 26px -6px rgb(232 230 225 / .6); background:#05090d; flex-shrink:0; }
.aow-photo.ph { display:flex; align-items:center; justify-content:center; font-size:44px; color:rgb(255 255 255 / .35); }
.aow-spot-main { flex:1; min-width:0; }
.aow-spot-name { font-family:var(--font-display); font-size:22px; font-weight:800; color:#fff; }
.aow-spot-sub { font-size:11px; letter-spacing:.1em; color:var(--text-faint); text-transform:uppercase; margin-top:1px; }
.aow-spot-metrics { display:flex; gap:22px; margin-top:12px; }
.aow-m .n { font-family:var(--font-display); font-size:20px; font-weight:700; color:var(--text-soft); font-variant-numeric:tabular-nums; }
.aow-m .k { font-size:9px; letter-spacing:.14em; color:var(--text-faint); text-transform:uppercase; }
.aow-spot-score { text-align:center; flex-shrink:0; padding-left:6px; }
.aow-spot-score .sv { font-family:var(--font-display); font-size:44px; font-weight:800; color:var(--text-soft); line-height:1; }
.aow-spot-score .sl { font-size:9px; letter-spacing:.2em; color:var(--text-faint); }

.aow-row { display:grid; grid-template-columns:34px 1fr auto; align-items:center; gap:12px; padding:11px 14px; border-radius:12px;
  border:1px solid var(--border); background:rgb(255 255 255 / .015); margin-bottom:8px; }
.aow-row .rk { font-family:var(--font-display); font-size:20px; font-weight:700; color:var(--text-faint); text-align:center; }
.aow-row.top3 .rk { color:var(--text-soft); }
.aow-rp { width:38px; height:38px; border-radius:9px; object-fit:cover; border:1px solid var(--border); background:#05090d; }
.aow-rp.ph { display:flex; align-items:center; justify-content:center; color:rgb(255 255 255 / .3); }
.aow-rmid { min-width:0; }
.aow-rname { font-size:13.5px; font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.aow-rmetrics { display:flex; gap:14px; margin-top:3px; font-size:10.5px; color:var(--text-faint); }
.aow-rmetrics b { color:var(--text-soft); font-weight:600; font-variant-numeric:tabular-nums; }
.aow-rright { text-align:right; }
.aow-rscore { font-family:var(--font-display); font-size:18px; font-weight:700; color:var(--text-soft); }
.aow-bar { width:120px; height:5px; border-radius:3px; background:rgb(255 255 255 / .08); margin-top:5px; overflow:hidden; }
.aow-bar > i { display:block; height:100%; background:var(--text-soft); border-radius:3px; }

.aow-admin { margin-top:22px; border-top:1px dashed var(--border); padding-top:14px; }
.aow-admin summary { cursor:pointer; font-size:11px; letter-spacing:.14em; color:var(--text-faint); }
.aow-admin .grid { display:grid; grid-template-columns:1fr; gap:12px; margin-top:12px; }
.aow-admin label { font-size:10px; letter-spacing:.1em; color:var(--text-faint); display:block; margin-bottom:4px; }
.aow-admin input { width:100%; box-sizing:border-box; background:rgb(0 0 0 / .3); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:8px 10px; font-size:12.5px; }
.aow-btn { background:var(--text); color:#111013; border:0; border-radius:9px; padding:8px 16px; font-size:11px; font-weight:700; letter-spacing:.1em; cursor:pointer; }
.aow-empty { padding:26px; color:var(--text-faint); font-size:13px; }
`;

// Tokens are always shown in millions (M).
const kfmt = (n: number) => `${(n / 1e6).toFixed(n >= 1e8 ? 0 : n >= 1e7 ? 1 : 2)}M`;
const hfmt = (n: number) => `${Math.round(n * 10) / 10}`;

/** Live countdown to the window end (or ENDED). */
function useCountdown(endIso: string): { text: string; ended: boolean } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const end = new Date(endIso).getTime();
  let ms = end - now;
  if (ms <= 0) return { text: "ENDED", ended: true };
  const d = Math.floor(ms / 864e5); ms -= d * 864e5;
  const h = Math.floor(ms / 36e5); ms -= h * 36e5;
  const m = Math.floor(ms / 6e4); ms -= m * 6e4;
  const s = Math.floor(ms / 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return { text: d > 0 ? `${d}d ${p(h)}:${p(m)}:${p(s)}` : `${p(h)}:${p(m)}:${p(s)}`, ended: false };
}

const Photo = ({ src, cls }: { src: string | null; cls: string }) =>
  src ? <img className={cls} src={src} alt="" /> : <div className={`${cls} ph`}>◍</div>;

export default function AgentWeek({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData] = useState<AgentWeekAward | null>(null);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [prize, setPrize] = useState("");

  const load = useCallback(() => {
    window.cowork.scoringAgentWeek()
      .then((d) => { setData(d); setErr(""); })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (data) setPrize(data.prize); }, [data?.prize]); // eslint-disable-line

  const cd = useCountdown(data?.window.end ?? new Date().toISOString());
  const entries = data?.entries ?? [];
  const winner = entries[0];
  const rest = useMemo(() => entries.slice(1), [entries]);

  const save = async () => {
    setSaving(true);
    try {
      await window.cowork.agencyWeekConfig({ prize, startsAt: null, endsAt: null });
      load();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };

  const metricRow = (e: AgentWeekEntry) => (
    <div className="aow-rmetrics">
      <span><b>{hfmt(e.effortScore)}</b> hrs</span>
      <span><b>{kfmt(e.tokens)}</b> tokens</span>
    </div>
  );

  return (
    <div className="aow-root">
      <style>{CSS}</style>
      <div className="aow-head">
        <h2><IconTrophy size={20} style={{ display: "inline-block", verticalAlign: "-3px", marginRight: 8 }} /> Agent of the Week</h2>
        <div className="aow-clock">
          <div className="lbl">{cd.ended ? "WEEK" : "ENDS IN"}</div>
          <div className={`val${cd.ended ? " ended" : ""}`}>{cd.text}</div>
        </div>
      </div>

      {data?.prize && (
        <div className="aow-prize">
          <span className="tp"><IconGift size={22} /></span>
          <div><div className="pl">THIS WEEK'S PRIZE</div><div className="pt">{data.prize}</div></div>
        </div>
      )}

      <div className="aow-weights">
        Fair-weighted — <b>Effort {Math.round((data?.weights.effort ?? .75) * 100)}%</b> (Jira estimate-hours completed − penalties) · <b>Tokens {Math.round((data?.weights.tokens ?? .25) * 100)}%</b>, each scored against the roster's best.
      </div>

      {err && <div style={{ color: "#e63b2e", fontSize: 12, marginBottom: 10 }}>⚠ {err}</div>}

      {!data ? (
        <div className="aow-empty">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="aow-empty">No agents on the board yet.</div>
      ) : (
        <>
          {winner && (
            <div className="aow-spot" style={{ position: "relative" }}>
              <span className="crown"><IconCrown size={20} /></span>
              <Photo src={winner.photo} cls="aow-photo" />
              <div className="aow-spot-main">
                <div className="aow-spot-name">{winner.displayName}</div>
                <div className="aow-spot-sub">{winner.division || "—"}{winner.username ? ` · @${winner.username}` : ""}</div>
                <div className="aow-spot-metrics">
                  <div className="aow-m"><div className="n">{hfmt(winner.effortScore)}</div><div className="k">Effort hrs</div></div>
                  <div className="aow-m"><div className="n">{kfmt(winner.tokens)}</div><div className="k">Tokens</div></div>
                </div>
              </div>
              <div className="aow-spot-score"><div className="sv">{Math.round(winner.score)}</div><div className="sl">SCORE</div></div>
            </div>
          )}

          {rest.map((e) => (
            <div key={e.accountId} className={`aow-row${e.rank <= 3 ? " top3" : ""}`}>
              <div className="rk">{e.rank}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                <Photo src={e.photo} cls="aow-rp" />
                <div className="aow-rmid">
                  <div className="aow-rname">{e.displayName}</div>
                  {metricRow(e)}
                </div>
              </div>
              <div className="aow-rright">
                <div className="aow-rscore">{Math.round(e.score)}</div>
                <div className="aow-bar"><i style={{ width: `${Math.min(100, e.score)}%` }} /></div>
              </div>
            </div>
          ))}
        </>
      )}

      {isAdmin && (
        <details className="aow-admin">
          <summary>ADMIN — set this week's prize</summary>
          <div className="grid">
            <div>
              <label>PRIZE (shown to all agents)</label>
              <input value={prize} onChange={(e) => setPrize(e.target.value)} placeholder="e.g. $200 bonus + a day off" />
            </div>
            <div>
              <button className="aow-btn" disabled={saving} onClick={save}>{saving ? "SAVING…" : "SAVE PRIZE"}</button>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
