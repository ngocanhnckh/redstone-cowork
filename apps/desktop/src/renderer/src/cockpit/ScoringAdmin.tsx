import { useCallback, useEffect, useRef, useState } from "react";
import type { ScoringProjectConfig, ScoringBoard, SprintIssue, ScoringPenaltyView } from "../../../shared/scoring";

// Admin scoring console: enable + configure a Jira project (which statuses count as complete,
// penalty %, week timezone, targets), pick the week's critical tasks from the sprint, review +
// void the penalty ledger, grant/revoke admin, and trigger a manual scan.

const CSS = `
.sca-root { flex:1; min-height:0; overflow-y:auto; padding:14px; }
.sca-h { font-size:11px; letter-spacing:.2em; color:rgb(232 230 225 / .8); margin:0 0 10px; }
.sca-sub { font-size:9.5px; letter-spacing:.14em; color:var(--text-faint); text-transform:uppercase; margin:18px 0 8px; }
.sca-proj { display:flex; gap:6px; flex-wrap:wrap; align-items:center; margin-bottom:14px; }
.sca-proj button { background:transparent; border:1px solid var(--border); color:var(--text-soft); border-radius:8px; padding:5px 12px; font-size:11px; font-weight:600; cursor:pointer; }
.sca-proj button.on { background:rgb(232 230 225 / .22); color:var(--text); }
.sca-proj input { width:110px; background:rgb(0 0 0 / .3); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:5px 9px; font-size:11px; }
.sca-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.sca-f label { font-size:9.5px; letter-spacing:.1em; color:var(--text-faint); display:block; margin-bottom:4px; text-transform:uppercase; }
.sca-f input, .sca-f select { width:100%; box-sizing:border-box; background:rgb(0 0 0 / .3); border:1px solid var(--border); border-radius:8px; color:var(--text); padding:8px 10px; font-size:12.5px; }
.sca-full { grid-column:1 / -1; }
.sca-btn { background:var(--text); color:#111013; border:0; border-radius:9px; padding:8px 15px; font-size:11px; font-weight:700; letter-spacing:.08em; cursor:pointer; }
.sca-btn.ghost { background:transparent; border:1px solid var(--border); color:var(--text-soft); font-weight:600; }
.sca-row { display:flex; align-items:center; gap:10px; padding:7px 0; border-top:1px solid rgb(255 255 255 / .05); font-size:12px; }
.sca-row .k { font-family:var(--font-mono); color:var(--text-soft); flex-shrink:0; width:78px; }
.sca-row .s { flex:1; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.sca-chk { width:15px; height:15px; accent-color:var(--accent, #e63b2e); }
/* --- complete-statuses picker --- */
.sca-fb { font-family:var(--font-mono); font-size:10.5px; letter-spacing:.1em; white-space:nowrap; overflow:hidden;
  text-overflow:ellipsis; max-width:280px; animation:sca-fb-in .18s ease both; }
.sca-fb.ok { color:var(--text-soft); }
.sca-fb.err { color:#e63b2e; }
@keyframes sca-fb-in { from { opacity:0; transform:translateX(-4px); } }
.sca-chip { display:inline-flex; align-items:center; background:rgba(232,230,225,.08); border:1px solid var(--border);
  color:var(--text); font-family:var(--font-mono); font-size:11px; padding:3px 8px; cursor:pointer; }
.sca-chip:hover { border-color:#e63b2e; }
.sca-menu { position:absolute; z-index:40; left:0; right:0; top:calc(100% + 4px); max-height:230px; overflow-y:auto;
  border:1px solid var(--border-strong); background:color-mix(in srgb, var(--app-panel) 96%, transparent);
  box-shadow:0 18px 50px rgba(0,0,0,.6); }
.sca-mrow { display:flex; align-items:center; gap:9px; width:100%; text-align:left; background:none; border:0;
  color:var(--text); font-family:var(--font-mono); font-size:12px; padding:6px 9px; cursor:pointer; }
.sca-mrow:hover { background:rgba(232,230,225,.06); }
.sca-chk-box { width:11px; height:11px; border:1px solid var(--text-soft); flex-shrink:0; position:relative; }
.sca-chk-box[data-on="1"] { background:var(--text); border-color:var(--text); }
.sca-tbl { width:100%; border-collapse:collapse; font-size:11.5px; }
.sca-tbl th { text-align:left; color:var(--text-faint); font-size:9px; letter-spacing:.12em; padding:4px 6px; }
.sca-tbl td { padding:6px 6px; border-top:1px solid var(--border); }
.sca-tbl tr.void td { opacity:.4; text-decoration:line-through; }
.sca-mut { color:var(--text-faint); font-size:11px; }
`;

const asNum = (v: string, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/**
 * An action button that reports its own outcome, right where it was pressed.
 *
 * A save that silently succeeds is indistinguishable from one that silently
 * failed, so every mutating control uses this: it disables + shows progress while
 * running, then confirms or shows the error inline next to the button. Feedback
 * in a far-away header does not count — the operator is looking at the button.
 */
function ActionButton({ label, run, busyLabel = "WORKING…", doneLabel = "SAVED", className = "sca-btn", disabled }:
  { label: string; run: () => Promise<unknown>; busyLabel?: string; doneLabel?: string; className?: string; disabled?: boolean }) {
  const [state, setState] = useState<"idle" | "run" | "ok" | "err">("idle");
  const [why, setWhy] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const click = async () => {
    if (state === "run") return;
    if (timer.current) clearTimeout(timer.current);
    setState("run"); setWhy("");
    try {
      await run();
      setState("ok");
      timer.current = setTimeout(() => setState("idle"), 2600);
    } catch (e) {
      setState("err");
      setWhy(e instanceof Error ? e.message : String(e));
      // Errors persist until the next attempt — they must not disappear unread.
    }
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9, minWidth: 0 }}>
      <button className={className} disabled={disabled || state === "run"} onClick={click}>
        {state === "run" ? busyLabel : label}
      </button>
      {state === "ok" && (
        <span className="sca-fb ok" role="status">✓ {doneLabel}</span>
      )}
      {state === "err" && (
        <span className="sca-fb err" role="alert" title={why}>✕ {why || "FAILED"}</span>
      )}
    </span>
  );
}

/**
 * Complete-statuses picker: search the project's REAL workflow statuses (pulled
 * from Jira) and toggle them, instead of typing names into a comma list where a
 * typo silently stops an issue from ever counting as done.
 *
 * Statuses that no longer exist in the workflow are still shown as selected chips
 * so an old config is never silently dropped, and a name can still be added by
 * hand when Jira is unreachable.
 */
function StatusPicker({ project, selected, onChange }:
  { project: string; selected: string[]; onChange: (next: string[]) => void }) {
  const [all, setAll] = useState<Array<{ name: string; category: string }>>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!project) { setAll([]); return; }
    let alive = true;
    setLoading(true);
    window.cowork.scoringJiraStatuses(project)
      .then((r) => { if (alive) setAll(r ?? []); })
      .catch(() => { if (alive) setAll([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [project]);

  // Click-away closes the list.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const toggle = (name: string) =>
    onChange(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);

  const needle = q.trim().toLowerCase();
  const matches = all.filter((s) => !needle || s.name.toLowerCase().includes(needle));
  // A typed name that matches nothing can still be added — Jira may be unreachable.
  const canAddRaw = !!needle && !all.some((s) => s.name.toLowerCase() === needle) && !selected.some((s) => s.toLowerCase() === needle);

  return (
    <div ref={box} style={{ position: "relative" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        {selected.length === 0 && <span className="sca-mut" style={{ fontSize: 11 }}>None — any Done-category status counts.</span>}
        {selected.map((name) => {
          const known = all.some((s) => s.name === name);
          return (
            <button key={name} type="button" onClick={() => toggle(name)}
              title={known ? "Remove" : "Not in this project's workflow — remove"}
              className="sca-chip">
              {name}{known ? "" : " ?"}<span style={{ marginLeft: 6, opacity: 0.6 }}>✕</span>
            </button>
          );
        })}
      </div>
      <input
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && canAddRaw) { e.preventDefault(); toggle(q.trim()); setQ(""); }
          if (e.key === "Escape") setOpen(false);
        }}
        placeholder={loading ? "Loading statuses…" : all.length ? "Search statuses…" : "Type a status name…"}
      />
      {open && (
        <div className="sca-menu">
          {matches.length === 0 && !canAddRaw && (
            <div className="sca-mut" style={{ padding: "6px 9px", fontSize: 11 }}>
              {all.length ? "No match." : "No statuses from Jira — type a name and press Enter."}
            </div>
          )}
          {matches.map((s) => (
            <button key={s.name} type="button" className="sca-mrow" onClick={() => toggle(s.name)}>
              <span className="sca-chk-box" data-on={selected.includes(s.name) ? "1" : "0"} />
              <span style={{ flex: 1, minWidth: 0 }}>{s.name}</span>
              <span className="sca-mut" style={{ fontSize: 9.5, letterSpacing: ".1em", textTransform: "uppercase" }}>{s.category}</span>
            </button>
          ))}
          {canAddRaw && (
            <button type="button" className="sca-mrow" onClick={() => { toggle(q.trim()); setQ(""); }}>
              <span className="sca-chk-box" data-on="0" />
              <span style={{ flex: 1 }}>Add “{q.trim()}”</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ScoringAdmin() {
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState("");
  const [jiraProjects, setJiraProjects] = useState<Array<{ key: string; name: string }>>([]);
  const [newKey, setNewKey] = useState("");
  const [cfg, setCfg] = useState<ScoringProjectConfig | null>(null);
  const [board, setBoard] = useState<ScoringBoard | null>(null);
  const [sprint, setSprint] = useState<SprintIssue[]>([]);
  const [critical, setCritical] = useState<Set<string>>(new Set());
  const [penalties, setPenalties] = useState<ScoringPenaltyView[]>([]);
  const [showVoided, setShowVoided] = useState(false);
  const [agents, setAgents] = useState<AgentAccount[]>([]);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(""), 2500); };
  const fail = (e: unknown) => { setErr(e instanceof Error ? e.message : String(e)); };
  /** Wrap a mutating action so ActionButton sees the failure (it renders the
   *  message next to the button) while the panel-level banner still updates. */
  const reported = async <T,>(fn: () => Promise<T>): Promise<T> => {
    setErr("");
    try { return await fn(); } catch (e) { fail(e); throw e; }
  };

  useEffect(() => {
    window.cowork.scoringConfigs().then((cs) => {
      const keys = cs.map((c) => c.projectKey);
      setProjects(keys);
      setProject((cur) => cur || keys[0] || "");
    }).catch(fail);
    window.cowork.accountsList().then(setAgents).catch(() => {});
    window.cowork.scoringJiraProjects().then(setJiraProjects).catch(() => setJiraProjects([]));
  }, []);

  const loadProject = useCallback(() => {
    if (!project) return;
    window.cowork.scoringConfigGet(project).then(setCfg).catch(fail);
    window.cowork.scoringBoard(project).then(setBoard).catch(() => setBoard(null));
    window.cowork.scoringSprintIssues(project).then(setSprint).catch(() => setSprint([]));
    window.cowork.scoringPenalties(project, showVoided).then(setPenalties).catch(() => setPenalties([]));
  }, [project, showVoided]);
  useEffect(() => { loadProject(); }, [loadProject]);

  // Load the currently-marked critical set once we know the week.
  useEffect(() => {
    if (!project || !board) return;
    window.cowork.scoringCriticalGet(project, board.weekKey)
      .then((c) => setCritical(new Set(c.items.map((i) => i.issueKey))))
      .catch(() => setCritical(new Set()));
  }, [project, board?.weekKey]); // eslint-disable-line

  const addProject = async (key?: string) => {
    const k = (key ?? newKey).trim().toUpperCase();
    if (!k) return;
    setBusy(true);
    try {
      await window.cowork.scoringConfigSet(k, { enabled: true });
      setNewKey("");
      const cs = await window.cowork.scoringConfigs();
      setProjects(cs.map((c) => c.projectKey));
      setProject(k);
      flash(`Added ${k}`);
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const saveConfig = async () => {
    if (!cfg) return;
    setBusy(true);
    try {
      const saved = await window.cowork.scoringConfigSet(project, {
        completeStatuses: cfg.completeStatuses, reopenPenaltyPct: cfg.reopenPenaltyPct,
        followupPenaltyPct: cfg.followupPenaltyPct, weekTimezone: cfg.weekTimezone,
        defaultTeamTarget: cfg.defaultTeamTarget, defaultIndividualTarget: cfg.defaultIndividualTarget,
        enabled: cfg.enabled,
      });
      setCfg(saved);
      flash("Config saved");
    } catch (e) { fail(e); throw e; } finally { setBusy(false); }
  };

  const saveTargets = async () => {
    if (!board) return;
    setBusy(true);
    try {
      const b = await window.cowork.scoringTargets({
        projectKey: project, weekKey: board.weekKey,
        teamTarget: board.teamTarget, individualTarget: board.individualTarget,
      });
      setBoard(b);
      flash("Targets saved");
    } catch (e) { fail(e); throw e; } finally { setBusy(false); }
  };

  const toggleCritical = (key: string) => {
    setCritical((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  };
  const saveCritical = async () => {
    if (!board) return;
    setBusy(true);
    try {
      await window.cowork.scoringCriticalSet({ projectKey: project, weekKey: board.weekKey, issueKeys: [...critical] });
      flash("Critical tasks saved");
    } catch (e) { fail(e); throw e; } finally { setBusy(false); }
  };

  const voidPenalty = async (id: string) => {
    setBusy(true);
    try { await window.cowork.scoringVoidPenalty(id); loadProject(); flash("Penalty voided"); }
    catch (e) { fail(e); } finally { setBusy(false); }
  };

  const scan = async () => {
    setBusy(true);
    try { const r = await window.cowork.scoringScan(project); flash(`Scanned: ${r.completions} completions, ${r.penalties} penalties`); loadProject(); }
    catch (e) { fail(e); throw e; } finally { setBusy(false); }
  };

  const setRole = async (id: string, role: "admin" | "member") => {
    setBusy(true);
    try {
      await window.cowork.accountUpdateProfile(id, { role });
      setAgents((prev) => prev.map((a) => (a.id === id ? { ...a, role } : a)));
      flash("Role updated");
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const patchCfg = (p: Partial<ScoringProjectConfig>) => setCfg((c) => (c ? { ...c, ...p } : c));

  return (
    <div className="sca-root">
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h3 className="sca-h" style={{ margin: 0 }}>SCORING · JIRA-EFFORT PERFORMANCE</h3>
        <span style={{ flex: 1 }} />
        {msg && <span style={{ fontSize: 10, color: "var(--text-soft)", letterSpacing: ".14em" }}>{msg}</span>}
      </div>
      {err && <div style={{ color: "#e63b2e", fontSize: 11.5, margin: "6px 0" }}>⚠ {err}</div>}

      <div className="sca-proj">
        {projects.map((k) => (
          <button key={k} className={k === project ? "on" : ""} onClick={() => setProject(k)}>{k}</button>
        ))}
        {jiraProjects.length > 0 ? (
          <select value="" disabled={busy} onChange={(e) => { if (e.target.value) addProject(e.target.value); }}
            style={{ background: "rgb(0 0 0 / .3)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", padding: "5px 9px", fontSize: 11 }}>
            <option value="">＋ ADD PROJECT…</option>
            {jiraProjects.filter((p) => !projects.includes(p.key)).map((p) => (
              <option key={p.key} value={p.key}>{p.key} — {p.name}</option>
            ))}
          </select>
        ) : (
          <>
            <input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="ADD KEY" onKeyDown={(e) => e.key === "Enter" && addProject()} />
            <button className="sca-btn ghost" disabled={busy} onClick={() => addProject()}>＋ ADD PROJECT</button>
          </>
        )}
      </div>

      {!project ? (
        <div className="sca-mut">Add a Jira project key (e.g. JP) to start scoring its team.</div>
      ) : (
        <>
          {/* Config */}
          {cfg && (
            <>
              <div className="sca-sub">Project config</div>
              <div className="sca-grid">
                <div className="sca-f sca-full">
                  <label>Complete statuses (blank = any Done-category)</label>
                  <StatusPicker
                    project={project}
                    selected={cfg.completeStatuses}
                    onChange={(next) => patchCfg({ completeStatuses: next })}
                  />
                </div>
                <div className="sca-f"><label>Reopen penalty %</label><input type="number" min={0} max={100} value={cfg.reopenPenaltyPct} onChange={(e) => patchCfg({ reopenPenaltyPct: asNum(e.target.value) })} /></div>
                <div className="sca-f"><label>Follow-up penalty %</label><input type="number" min={0} max={100} value={cfg.followupPenaltyPct} onChange={(e) => patchCfg({ followupPenaltyPct: asNum(e.target.value) })} /></div>
                <div className="sca-f"><label>Week timezone</label><input value={cfg.weekTimezone} onChange={(e) => patchCfg({ weekTimezone: e.target.value })} placeholder="Asia/Ho_Chi_Minh" /></div>
                <div className="sca-f"><label>Enabled (scanned)</label><select value={cfg.enabled ? "1" : "0"} onChange={(e) => patchCfg({ enabled: e.target.value === "1" })}><option value="1">Yes</option><option value="0">No</option></select></div>
                <div className="sca-f"><label>Default team target (hrs)</label><input type="number" min={0} value={cfg.defaultTeamTarget} onChange={(e) => patchCfg({ defaultTeamTarget: asNum(e.target.value) })} /></div>
                <div className="sca-f"><label>Default individual target (hrs)</label><input type="number" min={0} value={cfg.defaultIndividualTarget} onChange={(e) => patchCfg({ defaultIndividualTarget: asNum(e.target.value) })} /></div>
                <div className="sca-full" style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                  <ActionButton label="SAVE CONFIG" doneLabel="CONFIG SAVED" run={() => reported(saveConfig)} disabled={busy} />
                  <ActionButton label="↻ SCAN NOW" busyLabel="SCANNING…" doneLabel="SCAN COMPLETE"
                    className="sca-btn ghost" run={() => reported(scan)} disabled={busy} />
                </div>
              </div>
            </>
          )}

          {/* This week's targets */}
          {board && (
            <>
              <div className="sca-sub">This week's targets · {board.weekKey}</div>
              <div className="sca-grid">
                <div className="sca-f"><label>Team target (hrs)</label><input type="number" min={0} value={board.teamTarget} onChange={(e) => setBoard({ ...board, teamTarget: asNum(e.target.value) })} /></div>
                <div className="sca-f"><label>Individual target (hrs)</label><input type="number" min={0} value={board.individualTarget} onChange={(e) => setBoard({ ...board, individualTarget: asNum(e.target.value) })} /></div>
                <div className="sca-full"><ActionButton label="SAVE TARGETS" doneLabel="TARGETS SAVED" run={() => reported(saveTargets)} disabled={busy} /></div>
              </div>
            </>
          )}

          {/* Critical tasks (from current sprint) */}
          <div className="sca-sub">Critical tasks · pick from current sprint ({critical.size} selected)</div>
          {sprint.length === 0 ? (
            <div className="sca-mut">No open-sprint issues found for {project}.</div>
          ) : (
            <div>
              {sprint.map((i) => (
                <label key={i.key} className="sca-row" style={{ cursor: "pointer" }}>
                  <input type="checkbox" className="sca-chk" checked={critical.has(i.key)} onChange={() => toggleCritical(i.key)} />
                  <span className="k">{i.key}</span>
                  <span className="s">{i.summary}</span>
                  <span className="sca-mut" style={{ flexShrink: 0 }}>{i.status}</span>
                </label>
              ))}
              <div style={{ marginTop: 10 }}><ActionButton label="SAVE CRITICAL LIST" doneLabel="CRITICAL LIST SAVED" run={() => reported(saveCritical)} disabled={busy} /></div>
            </div>
          )}

          {/* Penalty ledger */}
          <div className="sca-sub" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            Penalty ledger
            <label style={{ fontSize: 9.5, letterSpacing: ".08em", display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
              <input type="checkbox" className="sca-chk" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} /> show voided
            </label>
          </div>
          {penalties.length === 0 ? (
            <div className="sca-mut">No penalties recorded for {project}.</div>
          ) : (
            <table className="sca-tbl">
              <thead><tr><th>WHEN</th><th>ISSUE</th><th>AGENT</th><th>TYPE</th><th>POINTS</th><th>DETAIL</th><th></th></tr></thead>
              <tbody>
                {penalties.map((p) => (
                  <tr key={p.id} className={p.voided ? "void" : ""}>
                    <td className="sca-mut">{new Date(p.occurredAt).toLocaleDateString()}</td>
                    <td style={{ fontFamily: "var(--font-mono)" }}>{p.issueKey}</td>
                    <td>{p.displayName}</td>
                    <td>{p.type}</td>
                    <td style={{ color: "var(--warn, #e0a44a)", fontVariantNumeric: "tabular-nums" }}>{p.points}</td>
                    <td className="sca-mut">{p.detail}</td>
                    <td>{!p.voided && <button className="sca-btn ghost" style={{ padding: "3px 9px", fontSize: 10 }} disabled={busy} onClick={() => voidPenalty(p.id)}>VOID</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {/* Admin roles */}
          <div className="sca-sub">Admin access · grant or revoke</div>
          <table className="sca-tbl">
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td><b style={{ color: "var(--text)" }}>{a.displayName || a.username}</b> <span className="sca-mut">@{a.username}</span></td>
                  <td style={{ color: a.role === "admin" ? "var(--text)" : "var(--text-faint)" }}>{a.role === "admin" ? "DIRECTOR (admin)" : "member"}</td>
                  <td style={{ textAlign: "right" }}>
                    {a.role === "admin"
                      ? <button className="sca-btn ghost" style={{ padding: "3px 9px", fontSize: 10 }} disabled={busy} onClick={() => setRole(a.id, "member")}>REVOKE ADMIN</button>
                      : <button className="sca-btn ghost" style={{ padding: "3px 9px", fontSize: 10 }} disabled={busy} onClick={() => setRole(a.id, "admin")}>MAKE ADMIN</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
