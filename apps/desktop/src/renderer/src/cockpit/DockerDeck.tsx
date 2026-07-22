import { useEffect, useState } from "react";
import { DockerHostView, DockerContainer } from "../types";
import { useStore } from "../store";
import { bestDockerHost } from "./dockerHost";

const fmtBytes = (b: number | null): string => {
  if (!b || b <= 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i <= 1 ? 0 : 1)}${u[i]}`;
};

const stateColor = (s: string): string =>
  s === "running" ? "rgb(var(--accent))"
  : s === "restarting" ? "#D8A76A"
  : s === "paused" ? "#8FB0C8"
  : "var(--border-strong)"; // exited / created / dead

function ContainerRow({ c }: { c: DockerContainer }) {
  const running = c.state === "running";
  const short = c.name.replace(/^\//, "");
  return (
    <div style={{ padding: "7px 9px", borderRadius: 8, background: "rgb(var(--primary) / 0.04)", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, flexShrink: 0, background: stateColor(c.state), boxShadow: running ? "0 0 0 3px rgb(var(--accent) / 0.14)" : "none" }} className={running ? "hud-pulse" : undefined} />
        <span style={{ fontSize: 11.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }} title={short}>{short}</span>
        <span className="mono faint" style={{ fontSize: 9 }}>{c.state}</span>
      </div>
      <div className="mono faint" style={{ fontSize: 9, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.image}>{c.image}</div>
      {running && (
        <div style={{ display: "flex", gap: 8, marginTop: 5, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="mono faint" style={{ fontSize: 8.5 }}>CPU</span>
              <span className="mono" style={{ fontSize: 9 }}>{c.cpuPct != null ? `${c.cpuPct.toFixed(0)}%` : "—"}</span>
            </div>
            <div style={{ height: 3, borderRadius: 999, background: "var(--border)", overflow: "hidden", marginTop: 2 }}>
              <div style={{ height: "100%", width: `${Math.min(100, c.cpuPct ?? 0)}%`, background: "rgb(var(--primary-soft))", transition: "width .5s" }} />
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="mono faint" style={{ fontSize: 8.5 }}>MEM</span>
              <span className="mono" style={{ fontSize: 9 }}>{fmtBytes(c.memUsed)}</span>
            </div>
            <div style={{ height: 3, borderRadius: 999, background: "var(--border)", overflow: "hidden", marginTop: 2 }}>
              <div style={{ height: "100%", width: `${Math.min(100, c.memPct ?? 0)}%`, background: "rgb(var(--accent))", transition: "width .5s" }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Docker containers on the host that runs the SELECTED session (matched by
 * machine name), mirroring the System-status widget — not all hosts at once. */
export default function DockerDeck() {
  const [hosts, setHosts] = useState<DockerHostView[]>([]);
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const session = sessions.find((s) => s.id === focusId) ?? queue.find((s) => s.id === focusId);
  const machine = session?.machine ?? null;

  useEffect(() => {
    let alive = true;
    const load = () => window.cowork.getDocker().then((d) => { if (alive) setHosts(d as DockerHostView[]); }).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Only the docker report for the focused session's host — the BEST one when the
  // feed carries duplicate entries for a machine (see bestDockerHost).
  const host = bestDockerHost(hosts, machine);
  const containers = host?.available ? host.containers : [];
  const totalRunning = containers.filter((c) => c.state === "running").length;
  const total = containers.length;

  const empty = (msg: React.ReactNode) => (
    <span className="mono faint" style={{ fontSize: 10.5, padding: "4px 6px", lineHeight: 1.5 }}>{msg}</span>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 4px 8px" }}>
        <span style={{ fontSize: 13 }}>🐳</span>
        <span className="mono" style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-soft)" }}>
          Docker{machine ? ` · ${machine}` : ""}
        </span>
        <span style={{ flex: 1 }} />
        {total > 0 && <span className="mono" style={{ fontSize: 9.5, color: "rgb(var(--accent))" }}>{totalRunning}/{total} up</span>}
      </div>
      <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
        {!session
          ? empty("Select a session to see its host's containers.")
          : !host
          ? empty(<>No Docker report from <span className="mono" style={{ color: "var(--text)" }}>{machine}</span> yet.</>)
          : !host.available
          ? empty(<>Docker is not available on <span className="mono" style={{ color: "var(--text)" }}>{machine}</span>.</>)
          : containers.length === 0
          ? empty(<>No containers running on <span className="mono" style={{ color: "var(--text)" }}>{machine}</span>.</>)
          : containers.map((c) => <ContainerRow key={c.id || c.name} c={c} />)}
      </div>
    </div>
  );
}
