import { useCallback, useEffect, useMemo, useState } from "react";
import type { ScoringBoard, ScoreHistory, ScoringProjectRef } from "../../../shared/scoring";
import { IconCheckCircle } from "./Icons";

// The per-project effort leaderboard: team score vs target, the admin's critical-task
// checklist for the week, the ranked roster (completed estimate-hours − penalties), and the
// signed-in agent's own week-by-week score history. One board per Jira project ("team").

const CSS = `
.sb-root { padding: 4px 20px 30px; }
.sb-head { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:6px 0 14px; }
.sb-head h2 { font-family:var(--font-display); font-size:22px; font-weight:800; letter-spacing:.02em; margin:0; color:var(--text); }
.sb-proj { display:flex; gap:6px; margin-left:auto; flex-wrap:wrap; }
.sb-proj button { background:transparent; border:1px solid var(--border); color:var(--text-soft); border-radius:8px; padding:5px 12px; font-size:11px; font-weight:600; letter-spacing:.08em; cursor:pointer; }
.sb-proj button.on { background:rgb(232 230 225 / .2); color:var(--text); }
.sb-gauge { padding:14px 16px; border-radius:14px; margin-bottom:14px; background:rgb(232 230 225 / .05); border:1px solid rgb(232 230 225 / .22); }
.sb-gauge .top { display:flex; align-items:baseline; justify-content:space-between; }
.sb-gauge .lbl { font-size:9px; letter-spacing:.2em; color:var(--text-faint); text-transform:uppercase; }
.sb-gauge .val { font-family:var(--font-display); font-size:26px; font-weight:800; color:var(--text); font-variant-numeric:tabular-nums; }
.sb-gauge .tgt { font-size:11px; color:var(--text-faint); }
.sb-bar { height:6px; border-radius:3px; background:rgb(255 255 255 / .08); margin-top:9px; overflow:hidden; }
.sb-bar > i { display:block; height:100%; border-radius:3px; transition:width .5s ease; }

.sb-crit { padding:12px 16px; border-radius:14px; margin-bottom:16px; border:1px solid var(--border); background:rgb(255 255 255 / .015); }
.sb-crit .h { display:flex; align-items:center; gap:8px; font-size:10px; letter-spacing:.16em; color:var(--text-faint); text-transform:uppercase; margin-bottom:8px; }
.sb-crit .h b { color:var(--text-soft); font-variant-numeric:tabular-nums; }
.sb-ci { display:flex; align-items:center; gap:9px; padding:6px 0; border-top:1px solid rgb(255 255 255 / .05); }
.sb-ci:first-of-type { border-top:0; }
.sb-ci .k { font-family:var(--font-mono); font-size:11px; color:var(--text-soft); flex-shrink:0; }
.sb-ci .s { font-size:12px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; }
.sb-ci .st { font-size:9px; letter-spacing:.08em; text-transform:uppercase; }
.sb-ci.done .s { color:var(--text-faint); }
.sb-dot { width:14px; height:14px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center; }
.sb-hollow { width:11px; height:11px; border-radius:50%; border:2px solid var(--warn, #e0a44a); box-sizing:border-box; }

.sb-row { display:grid; grid-template-columns:30px 1fr auto; align-items:center; gap:12px; padding:10px 14px; border-radius:11px; border:1px solid var(--border); background:rgb(255 255 255 / .015); margin-bottom:7px; }
.sb-row .rk { font-family:var(--font-display); font-size:18px; font-weight:700; color:var(--text-faint); text-align:center; }
.sb-row.me { border-color:rgb(232 230 225 / .5); background:rgb(232 230 225 / .06); }
.sb-rp { width:34px; height:34px; border-radius:8px; object-fit:cover; border:1px solid var(--border); background:#05090d; }
.sb-rp.ph { display:flex; align-items:center; justify-content:center; color:rgb(255 255 255 / .3); font-size:15px; }
.sb-rname { font-size:13px; font-weight:600; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sb-rmeta { display:flex; gap:12px; margin-top:2px; font-size:10px; color:var(--text-faint); }
.sb-rmeta b { color:var(--text-soft); font-weight:600; font-variant-numeric:tabular-nums; }
.sb-rmeta .pen { color:var(--warn, #e0a44a); }
.sb-rscore { font-family:var(--font-display); font-size:18px; font-weight:700; color:var(--text-soft); text-align:right; font-variant-numeric:tabular-nums; }

.sb-hist { margin-top:20px; }
.sb-hist .h { font-size:10px; letter-spacing:.16em; color:var(--text-faint); text-transform:uppercase; margin-bottom:10px; }
.sb-spark { display:flex; align-items:flex-end; gap:6px; height:70px; }
.sb-scol { flex:1; display:flex; flex-direction:column; align-items:center; gap:5px; min-width:0; }
.sb-scol > .bar { width:60%; max-width:26px; background:var(--accent, #e63b2e); border-radius:3px 3px 0 0; }
.sb-scol > .wk { font-size:8px; color:var(--text-faint); white-space:nowrap; }
.sb-scol > .sc { font-size:9px; color:var(--text-soft); font-variant-numeric:tabular-nums; }
.sb-empty { padding:24px; color:var(--text-faint); font-size:13px; }
`;

const hfmt = (n: number) => `${Math.round(n * 10) / 10}`;
const pct = (v: number, t: number) => (t > 0 ? Math.min(100, Math.round((v / t) * 100)) : (v > 0 ? 100 : 0));
const Photo = ({ src }: { src: string | null }) => (src ? <img className="sb-rp" src={src} alt="" /> : <div className="sb-rp ph">◍</div>);

export default function ScoreBoard({ meId }: { meId: string | null }) {
  const [projects, setProjects] = useState<ScoringProjectRef[]>([]);
  const [project, setProject] = useState<string>("");
  const [board, setBoard] = useState<ScoringBoard | null>(null);
  const [history, setHistory] = useState<ScoreHistory | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    window.cowork.scoringProjects()
      .then((ps) => {
        const enabled = ps.filter((p) => p.enabled);
        setProjects(enabled.length ? enabled : ps);
        setProject((cur) => cur || (enabled[0] ?? ps[0])?.projectKey || "");
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const load = useCallback(() => {
    if (!project) return;
    window.cowork.scoringBoard(project).then((b) => { setBoard(b); setErr(""); }).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    window.cowork.scoringHistory(project).then(setHistory).catch(() => setHistory(null));
  }, [project]);
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const maxHist = useMemo(() => Math.max(1, ...(history?.points ?? []).map((p) => p.score)), [history]);
  const crit = board?.critical;

  return (
    <div className="sb-root">
      <style>{CSS}</style>
      <div className="sb-head">
        <h2>Team Scoreboard</h2>
        <div className="sb-proj">
          {projects.map((p) => (
            <button key={p.projectKey} className={p.projectKey === project ? "on" : ""} onClick={() => setProject(p.projectKey)}>{p.projectKey}</button>
          ))}
        </div>
      </div>

      {err && <div style={{ color: "#e63b2e", fontSize: 12, marginBottom: 10 }}>⚠ {err}</div>}
      {projects.length === 0 ? (
        <div className="sb-empty">No projects are scored yet. An admin can enable a Jira project in the Admin → Scoring tab.</div>
      ) : !board ? (
        <div className="sb-empty">Loading {project}…</div>
      ) : (
        <>
          {/* Team gauge */}
          <div className="sb-gauge">
            <div className="top">
              <div>
                <div className="lbl">Team score · week of {board.weekKey}</div>
                <div className="val">{hfmt(board.teamScore)} <span className="tgt">/ {hfmt(board.teamTarget)} hrs target</span></div>
              </div>
            </div>
            <div className="sb-bar"><i style={{ width: `${pct(board.teamScore, board.teamTarget)}%`, background: board.teamTarget > 0 && board.teamScore >= board.teamTarget ? "var(--ok, #3fb984)" : "var(--accent, #e63b2e)" }} /></div>
          </div>

          {/* Critical checklist */}
          {crit && crit.total > 0 && (
            <div className="sb-crit">
              <div className="h">Critical this week <b>{crit.done}/{crit.total} done</b></div>
              {crit.items.map((i) => (
                <div key={i.issueKey} className={`sb-ci${i.done ? " done" : ""}`}>
                  <span className="sb-dot">{i.done ? <IconCheckCircle size={14} /> : <span className="sb-hollow" />}</span>
                  <span className="k">{i.issueKey}</span>
                  <span className="s">{i.summary || "—"}</span>
                  <span className="st" style={{ color: i.done ? "var(--ok, #3fb984)" : "var(--warn, #e0a44a)" }}>{i.status || "—"}</span>
                </div>
              ))}
            </div>
          )}

          {/* Ranked roster */}
          {board.entries.length === 0 ? (
            <div className="sb-empty">No scored work yet this week. Estimated tasks earn their hours when completed.</div>
          ) : board.entries.map((e) => (
            <div key={e.accountId ?? e.jiraUser} className={`sb-row${e.accountId && e.accountId === meId ? " me" : ""}`}>
              <div className="rk">{e.rank}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
                <Photo src={e.photo} />
                <div style={{ minWidth: 0 }}>
                  <div className="sb-rname">{e.displayName}</div>
                  <div className="sb-rmeta">
                    <span><b>{hfmt(e.completedHours)}</b> hrs</span>
                    {e.penaltyHours > 0 && <span className="pen">−{hfmt(e.penaltyHours)} penalty</span>}
                    <span><b>{e.completions}</b> done</span>
                  </div>
                </div>
              </div>
              <div className="sb-rscore">{hfmt(e.score)}</div>
            </div>
          ))}

          {/* My history */}
          {history && history.points.length > 0 && (
            <div className="sb-hist">
              <div className="h">My score history</div>
              <div className="sb-spark">
                {history.points.map((p) => (
                  <div key={p.weekKey} className="sb-scol" title={`${p.weekKey}: ${hfmt(p.score)} (${hfmt(p.completedHours)}h − ${hfmt(p.penaltyHours)})`}>
                    <div className="sc">{hfmt(p.score)}</div>
                    <div className="bar" style={{ height: `${Math.max(2, Math.round((p.score / maxHist) * 46))}px` }} />
                    <div className="wk">{p.weekKey.slice(5)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
