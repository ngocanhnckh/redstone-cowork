import { useEffect, useMemo, useState } from "react";
import { ratingsFor, ovrOf, STAT_LABELS, type Analytics, type Stats } from "./agencyStats";
import { findRank } from "./ranks";
import type { AgencyMission, AgencyMissionDetail, AgencyMissionTransition, AgencyGithubStat } from "../../../shared/agency";
import { Tiles, Bars, ActivityChart, GithubHeatmap, fmtK } from "./agencyCharts";

// ——— AGENCY · agent dossier ———
// The Agency main screen for the signed-in agent: profile header, a radar of the five
// characteristics + OVR, a real cumulative-activity chart (from session history), and
// their assigned Jira missions (newest first) — clickable for detail / status / comments.
// All stats are REAL (telemetry + Jira), never mocked.

type Me = { accountId: string; username: string; displayName: string; photo: string | null; level: string; division: string; bio: string; github: string; jira: string; role: string };

const AXES: Array<{ key: keyof Stats; label: string }> = STAT_LABELS.map((l) => ({ key: l.key, label: l.long }));

function polar(cx: number, cy: number, r: number, i: number, n: number): [number, number] {
  const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
}

/** SVG radar/spider chart of the five sub-ratings (0–99). */
function Radar({ stats }: { stats: Stats }) {
  const S = 240, cx = S / 2, cy = S / 2, R = 88, n = AXES.length;
  const rings = [0.25, 0.5, 0.75, 1];
  const shape = AXES.map((ax, i) => polar(cx, cy, R * (stats[ax.key] / 99), i, n).join(",")).join(" ");
  return (
    <svg width="100%" viewBox={`0 0 ${S} ${S}`} style={{ maxWidth: 300 }}>
      {rings.map((rr, ri) => (
        <polygon key={ri} points={AXES.map((_, i) => polar(cx, cy, R * rr, i, n).join(",")).join(" ")}
          fill="none" stroke="rgb(var(--primary-soft) / 0.18)" strokeWidth={1} />
      ))}
      {AXES.map((_, i) => { const [x, y] = polar(cx, cy, R, i, n); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgb(var(--primary-soft) / 0.18)" strokeWidth={1} />; })}
      <polygon points={shape} fill="rgb(var(--primary) / 0.28)" stroke="rgb(var(--primary))" strokeWidth={2} />
      {AXES.map((ax, i) => {
        const [x, y] = polar(cx, cy, R * (stats[ax.key] / 99), i, n);
        const [lx, ly] = polar(cx, cy, R + 20, i, n);
        return (
          <g key={ax.key}>
            <circle cx={x} cy={y} r={3} fill="rgb(var(--accent))" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontFamily="var(--font-mono)" letterSpacing="0.1em" fill="rgb(var(--primary-soft))">{ax.label}</text>
            <text x={lx} y={ly + 11} textAnchor="middle" fontSize={10} fontWeight={700} fontFamily="var(--font-mono)" fill="#e6f2f4">{stats[ax.key]}</text>
          </g>
        );
      })}
    </svg>
  );
}

/** Cumulative activity area chart from real session history (value over time). */

function MissionDetail({ mission, onClose, onChanged }: { mission: AgencyMission; onClose: () => void; onChanged: () => void }) {
  const [detail, setDetail] = useState<AgencyMissionDetail | null>(null);
  const [transitions, setTransitions] = useState<AgencyMissionTransition[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const reload = () => {
    window.cowork.agencyMissionDetail(mission.key).then(setDetail).catch(() => setErr("Could not load the mission."));
    window.cowork.agencyMissionTransitions(mission.key).then(setTransitions).catch(() => setTransitions([]));
  };
  useEffect(reload, [mission.key]);

  const applyTransition = async (id: string) => {
    setBusy(true); setErr("");
    try { await window.cowork.agencyMissionTransition(mission.key, id); reload(); onChanged(); }
    catch { setErr("Transition failed."); }
    finally { setBusy(false); }
  };
  const send = async () => {
    const b = comment.trim(); if (!b || busy) return;
    setBusy(true); setErr("");
    try { await window.cowork.agencyMissionComment(mission.key, b); setComment(""); reload(); }
    catch { setErr("Could not add comment."); }
    finally { setBusy(false); }
  };

  return (
    <div className="agp-modal" onClick={onClose}>
      <div className="agp-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="agp-sheet-hd">
          <div style={{ minWidth: 0 }}>
            <span className="mono" style={{ fontSize: 10, color: "rgb(var(--primary-soft))", letterSpacing: "0.14em" }}>{mission.key}{mission.project ? ` · ${mission.project.name}` : ""}</span>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#e6f2f4", marginTop: 3 }}>{detail?.summary ?? mission.summary}</div>
          </div>
          <button className="agp-x" onClick={onClose}>✕</button>
        </div>
        {err && <div style={{ color: "#ff9d94", fontSize: 12, marginBottom: 8 }}>⚠ {err}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <span className="agp-status">{detail?.status ?? mission.status}</span>
          {transitions.map((t) => (
            <button key={t.id} className="agp-trans" disabled={busy} onClick={() => applyTransition(t.id)} title={`Move to ${t.to}`}>→ {t.name}</button>
          ))}
          {detail?.url && <a href={detail.url} target="_blank" rel="noreferrer" className="agp-open">Open in Jira ↗</a>}
        </div>
        {detail?.descriptionHtml && (
          <div className="agp-desc no-scrollbar" dangerouslySetInnerHTML={{ __html: detail.descriptionHtml }} />
        )}
        <div className="mono" style={{ fontSize: 9, letterSpacing: "0.22em", color: "rgb(var(--primary-soft))", margin: "14px 0 8px" }}>COMMENTS</div>
        <div className="agp-comments no-scrollbar">
          {detail?.comments?.length ? detail.comments.map((c, i) => (
            <div key={i} className="agp-comment">
              <div style={{ fontSize: 10.5, color: "rgb(var(--primary-soft))", marginBottom: 3 }}>{c.author ?? "—"} · <span style={{ color: "var(--text-faint)" }}>{new Date(c.created).toLocaleString()}</span></div>
              <div className="agp-comment-body" dangerouslySetInnerHTML={{ __html: c.bodyHtml }} />
            </div>
          )) : <div className="soft" style={{ fontSize: 11.5 }}>No comments yet.</div>}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <input className="agp-input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a comment…"
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <button className="agp-send" onClick={send} disabled={busy || !comment.trim()}>COMMENT</button>
        </div>
      </div>
    </div>
  );
}

const catColor: Record<string, string> = { todo: "var(--text-faint)", inprogress: "rgb(var(--accent))", done: "#5ef2b0" };

export default function AgencyProfile() {
  const [me, setMe] = useState<Me | null>(null);
  const [series, setSeries] = useState<Array<{ t: number; v: number }>>([]);
  const [missions, setMissions] = useState<AgencyMission[]>([]);
  const [open, setOpen] = useState<AgencyMission | null>(null);
  const [completed, setCompleted] = useState(0);
  const [gh, setGh] = useState<AgencyGithubStat | null>(null);
  const [jira, setJira] = useState<{ completed: number; inProgress: number; todo: number; total: number } | null>(null);
  const [analyticsRow, setAnalyticsRow] = useState<Analytics | null>(null);

  const loadMissions = () => window.cowork.agencyMissions().then(setMissions).catch(() => setMissions([]));

  useEffect(() => {
    let alive = true;
    (async () => {
      const m = await window.cowork.accountsMe().catch(() => null);
      if (!alive || !m || !("username" in m) || !m.username) return;
      const acc = m as { id?: string; username: string; displayName: string; photo?: string | null; level?: string; division?: string; bio?: string; github?: string; jira?: string; role: string };
      const meObj: Me = {
        accountId: acc.id ?? "", username: acc.username, displayName: acc.displayName || acc.username, photo: acc.photo ?? null,
        level: acc.level || (acc.role === "admin" ? "General" : "Recruit"), division: acc.division ?? "", bio: acc.bio ?? "", github: acc.github ?? "", jira: acc.jira ?? "", role: acc.role,
      };
      setMe(meObj);

      const [analytics, jstats, sessions] = await Promise.all([
        window.cowork.accountsAnalytics().catch(() => []),
        window.cowork.agencyJiraStats().catch(() => []),
        meObj.accountId ? window.cowork.accountSessions(meObj.accountId).catch(() => []) : Promise.resolve([]),
      ]);
      if (!alive) return;
      const mine = (analytics as Analytics[]).find((r) => r.accountId === meObj.accountId)
        ?? (analytics as Analytics[]).find((r) => r.username === meObj.username);
      const done = (jstats.find((s) => s.accountId === meObj.accountId)?.completed) ?? 0;
      setCompleted(done);
      if (mine) setAnalyticsRow(mine);

      // Real GitHub + Jira-breakdown for the extra charts (best-effort, cached server-side).
      window.cowork.agencyGithubStats().then((g) => { if (alive) setGh(g); }).catch(() => {});
      window.cowork.agencyMyJira().then((j) => { if (alive) setJira(j); }).catch(() => {});

      // Real cumulative activity: tokens output over time from session history.
      const rows = (sessions as Array<{ lastSeenAt: string; tokensOutput: number }>)
        .filter((r) => r.lastSeenAt)
        .sort((a, b) => new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime());
      let cum = 0;
      setSeries(rows.map((r) => { cum += r.tokensOutput || 0; return { t: new Date(r.lastSeenAt).getTime(), v: cum }; }));
      loadMissions();
    })();
    return () => { alive = false; };
  }, []);

  const sortedMissions = useMemo(
    () => [...missions].sort((a, b) => (a.statusCategory === "done" ? 1 : 0) - (b.statusCategory === "done" ? 1 : 0)),
    [missions],
  );

  // Ratings are computed from GitHub + Jira + (minor) cowork — reactively, since GitHub
  // and Jira arrive after the initial profile load.
  const stats: Stats | null = useMemo(() => {
    if (!analyticsRow) return null;
    return ratingsFor({
      done: jira?.completed ?? completed,
      jiraTotal: jira?.total ?? 0,
      ghContrib: gh?.found ? gh.contribTotal : 0,
      ghActiveDays: gh?.found ? gh.days.filter((d) => d.count > 0).length : 0,
      tokensOut: analyticsRow.tokensOutput,
    });
  }, [analyticsRow, jira, gh, completed]);
  const ovr = stats ? ovrOf(stats) : 0;

  if (!me) return <div className="soft" style={{ padding: 24, fontSize: 13 }}>Loading your dossier…</div>;
  const rk = findRank(me.level);

  return (
    <div className="agp-root no-scrollbar">
      <style>{CSS}</style>
      {/* Profile header */}
      <div className="agp-hero">
        {me.photo ? <img className="agp-photo" src={me.photo} alt="" /> : <div className="agp-photo ph">◍</div>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="mono" style={{ fontSize: 10, letterSpacing: "0.3em", color: "rgb(var(--primary-soft))" }}>SPECIAL AGENT</div>
          <div style={{ fontSize: 28, fontWeight: 700, color: "#e6f2f4", lineHeight: 1.05 }}>{me.displayName}</div>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)", letterSpacing: "0.1em" }}>@{me.username}</div>
          {rk?.insignia && <div style={{ fontSize: 14, letterSpacing: "0.24em", color: "#ffd166", marginTop: 5 }}>{rk.insignia}</div>}
          <div style={{ display: "flex", gap: 7, marginTop: 7, flexWrap: "wrap" }}>
            <span className="agp-chip">★ {me.level}</span>
            {me.division && <span className="agp-chip alt">◈ {me.division}</span>}
            {me.github && <span className="agp-chip alt">⌥ {me.github}</span>}
            {me.jira && <span className="agp-chip alt">◇ {me.jira}</span>}
          </div>
          {me.bio && <div style={{ fontSize: 12.5, color: "var(--text-soft)", lineHeight: 1.6, marginTop: 9, maxWidth: 620 }}>{me.bio}</div>}
        </div>
        <div className="agp-ovr">
          <b>{ovr}</b><span>OVR</span>
        </div>
      </div>

      {/* Stat tiles — real numbers */}
      <Tiles items={[
        { label: "TOKENS", value: analyticsRow ? fmtK(analyticsRow.tokensInput + analyticsRow.tokensOutput) : "—", hint: analyticsRow ? `$${analyticsRow.estCostUsd.toFixed(2)} est` : undefined },
        { label: "TIME ON TASK", value: analyticsRow ? `${(analyticsRow.timeSpentMs / 3.6e6).toFixed(analyticsRow.timeSpentMs >= 3.6e7 ? 0 : 1)}h` : "—" },
        { label: "SESSIONS", value: analyticsRow ? String(analyticsRow.sessions) : "—", hint: analyticsRow ? `${analyticsRow.activeSessions} active` : undefined },
        { label: "JIRA DONE", value: jira ? String(jira.completed) : String(completed), hint: jira ? `${jira.total} total` : undefined },
        { label: "GH CONTRIB", value: gh?.found ? gh.contribTotal.toLocaleString() : (me.github ? "…" : "—"), hint: gh?.found ? "last year" : undefined },
        { label: "ACTIVE DAYS", value: gh?.found ? String(gh.days.filter((d) => d.count > 0).length) : (me.github ? "…" : "—") },
        { label: "REPOS", value: gh?.found ? String(gh.publicRepos) : (me.github ? "…" : "—"), hint: gh?.found ? `${gh.followers} followers` : undefined },
        { label: "OVERALL", value: String(ovr) },
      ]} />

      {/* Charts */}
      <div className="agp-charts">
        <div className="agp-panel" style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <div className="mono" style={{ fontSize: 9, letterSpacing: "0.22em", color: "rgb(var(--primary-soft))", alignSelf: "flex-start", marginBottom: 4 }}>CHARACTERISTICS</div>
          {stats ? <Radar stats={stats} /> : <div className="soft" style={{ fontSize: 12, padding: 30 }}>No telemetry yet.</div>}
        </div>
        <div className="agp-panel">
          <ActivityChart points={series} label="CUMULATIVE OUTPUT · TOKENS OVER TIME" />
        </div>
        <div className="agp-panel">
          <div className="mono" style={{ fontSize: 9, letterSpacing: "0.22em", color: "rgb(var(--primary-soft))", marginBottom: 12 }}>JIRA WORKLOAD</div>
          {jira && jira.total > 0 ? (
            <Bars rows={[
              { label: "TO DO", value: jira.todo, color: "var(--text-faint)" },
              { label: "IN PROG", value: jira.inProgress, color: "rgb(var(--accent))" },
              { label: "DONE", value: jira.completed, color: "#5ef2b0" },
            ]} />
          ) : <div className="soft" style={{ fontSize: 11.5 }}>{me.jira ? "No Jira issues assigned." : "Link a Jira username to see workload."}</div>}
        </div>
        <div className="agp-panel" style={{ gridColumn: "1 / -1" }}>
          {gh?.found ? (
            <GithubHeatmap days={gh.days} total={gh.contribTotal} />
          ) : <div className="soft" style={{ fontSize: 11.5 }}>{me.github ? "No public GitHub activity found (or rate-limited)." : "Add a GitHub username (ask an admin) to pull activity."}</div>}
        </div>
      </div>

      {/* Missions */}
      <div className="agp-missions-hd">
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.24em", color: "rgb(var(--primary-soft))" }}>ASSIGNED MISSIONS</span>
        <span className="soft" style={{ fontSize: 10.5 }}>{missions.length} on Jira · {completed} completed</span>
      </div>
      <div className="agp-missions">
        {missions.length === 0 ? (
          <div className="soft" style={{ fontSize: 12, padding: "10px 2px" }}>{me.jira ? "No Jira issues assigned to you." : "Link your Jira username (ask an admin) to see missions."}</div>
        ) : sortedMissions.map((m) => (
          <button key={m.key} className="agp-mission" onClick={() => setOpen(m)}>
            <span className="agp-dot" style={{ background: catColor[m.statusCategory] }} />
            <div style={{ minWidth: 0, flex: 1, textAlign: "left" }}>
              <div style={{ fontSize: 13, color: "#e6f2f4", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.summary}</div>
              <div className="mono" style={{ fontSize: 9.5, color: "var(--text-faint)", letterSpacing: "0.08em", marginTop: 2 }}>{m.key}{m.project ? ` · ${m.project.name}` : ""}</div>
            </div>
            <span className="agp-mstatus" style={{ color: catColor[m.statusCategory] }}>{m.status}</span>
          </button>
        ))}
      </div>

      {open && <MissionDetail mission={open} onClose={() => setOpen(null)} onChanged={loadMissions} />}
    </div>
  );
}

const CSS = `
.agp-root { flex:1; min-height:0; overflow-y:auto; padding:16px 20px 28px; font-family:var(--font-mono); }
.agp-hero { display:flex; gap:20px; align-items:flex-start; padding:16px 18px; border-radius:16px;
  border:1px solid rgb(var(--primary) / 0.28); background: rgb(var(--primary) / 0.05); }
.agp-photo { width:118px; height:118px; border-radius:16px; object-fit:cover; border:2px solid rgb(var(--primary) / 0.6); box-shadow:0 0 26px -6px rgb(var(--primary-soft)); background:#05090d; flex-shrink:0; }
.agp-photo.ph { display:flex; align-items:center; justify-content:center; font-size:52px; color: rgb(var(--primary-soft) / 0.5); }
.agp-chip { font-size:10px; letter-spacing:.14em; padding:3px 10px; border-radius:999px; border:1px solid rgb(224 162 74 / 0.5); color:#e0a24a; }
.agp-chip.alt { border-color: rgb(var(--primary) / 0.5); color: rgb(var(--primary-soft)); }
.agp-ovr { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:6px 14px; border-radius:14px; border:1px solid rgb(var(--accent) / 0.5); background: rgb(var(--accent) / 0.08); }
.agp-ovr b { font-family:var(--font-display); font-size:46px; line-height:.9; color: rgb(var(--accent)); text-shadow:0 0 16px rgb(var(--accent) / 0.6); }
.agp-ovr span { font-size:9px; letter-spacing:.24em; color: var(--text-soft); }
.agp-tiles { display:grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap:10px; margin-top:14px; }
.agp-tile { border:1px solid var(--border); border-radius:12px; padding:11px 13px; background: rgb(var(--primary) / 0.04); }
.agp-tile-v { font-family:var(--font-display); font-size:24px; line-height:1; color:#e6f2f4; }
.agp-tile-l { font-size:8.5px; letter-spacing:.18em; color: rgb(var(--primary-soft)); margin-top:6px; }
.agp-tile-h { font-size:9px; color: var(--text-faint); margin-top:2px; }
.agp-charts { display:grid; grid-template-columns: 1fr 1fr; gap:14px; margin-top:14px; }
.agp-panel { border:1px solid var(--border); border-radius:14px; padding:14px 16px; background: rgb(var(--primary) / 0.03); min-width:0; }
@media (max-width: 900px) { .agp-charts { grid-template-columns: 1fr; } }
.agp-missions-hd { display:flex; align-items:baseline; justify-content:space-between; margin:20px 2px 8px; }
.agp-missions { display:flex; flex-direction:column; gap:6px; }
.agp-mission { display:flex; align-items:center; gap:11px; padding:10px 13px; border-radius:11px; cursor:pointer; width:100%;
  border:1px solid var(--border); background: rgb(var(--primary) / 0.03); font-family:inherit; transition: border-color .14s, background .14s; }
.agp-mission:hover { border-color: rgb(var(--primary) / 0.55); background: rgb(var(--primary) / 0.09); }
.agp-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.agp-mstatus { font-size:10px; letter-spacing:.08em; white-space:nowrap; flex-shrink:0; }
.agp-modal { position:fixed; inset:0; z-index:400; background: rgb(2 6 10 / 0.72); backdrop-filter: blur(4px); display:flex; align-items:center; justify-content:center; padding:24px; }
.agp-sheet { width:640px; max-width:94vw; max-height:88vh; overflow-y:auto; border-radius:16px; padding:18px 20px 20px;
  border:1px solid rgb(var(--primary) / 0.4); background: rgb(8 14 20 / 0.98); box-shadow:0 30px 80px -20px rgb(0 0 0 / 0.8); font-family:var(--font-mono); }
.agp-sheet-hd { display:flex; align-items:flex-start; gap:12px; margin-bottom:12px; }
.agp-x { margin-left:auto; background:none; border:1px solid var(--border); color:var(--text-soft); border-radius:8px; width:30px; height:30px; cursor:pointer; flex-shrink:0; }
.agp-x:hover { color:#fff; border-color: rgb(var(--primary) / 0.6); }
.agp-status { font-size:10px; letter-spacing:.1em; padding:4px 11px; border-radius:999px; border:1px solid rgb(var(--primary) / 0.4); color: rgb(var(--primary-soft)); }
.agp-trans { font-size:10.5px; letter-spacing:.06em; padding:4px 11px; border-radius:999px; cursor:pointer;
  border:1px solid rgb(94 242 176 / 0.5); background: rgb(94 242 176 / 0.1); color:#8bffcf; font-family:inherit; }
.agp-trans:disabled { opacity:.5; cursor:progress; }
.agp-open { font-size:10.5px; color: rgb(var(--primary-soft)); text-decoration:none; margin-left:auto; }
.agp-desc { font-size:12.5px; color: var(--text-soft); line-height:1.6; max-height:200px; overflow-y:auto; padding:10px 12px; border-radius:10px; background: rgb(var(--primary) / 0.04); border:1px solid var(--border); }
.agp-desc img { max-width:100%; }
.agp-comments { display:flex; flex-direction:column; gap:9px; max-height:240px; overflow-y:auto; }
.agp-comment { border-left:2px solid rgb(var(--primary) / 0.4); padding-left:11px; }
.agp-comment-body { font-size:12.5px; color: var(--text); line-height:1.55; }
.agp-comment-body img { max-width:100%; }
.agp-input { flex:1; padding:10px 13px; border-radius:10px; font-size:13px; font-family:inherit; border:1px solid rgb(var(--primary) / 0.3); background: rgb(var(--primary) / 0.05); color: var(--text); outline:none; }
.agp-input:focus { border-color: rgb(var(--primary) / 0.7); }
.agp-send { padding:0 16px; border-radius:10px; border:1px solid rgb(var(--primary) / 0.6); cursor:pointer; background: rgb(var(--primary) / 0.2); color:#d9f7ff; font-family:inherit; font-size:11px; font-weight:700; letter-spacing:.16em; }
.agp-send:disabled { opacity:.4; cursor:not-allowed; }
`;
