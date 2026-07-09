import PortsPanel from "./PortsPanel";
import JiraSettings from "./JiraSettings";

/**
 * Per-session Settings — the tab formerly known as "Ports". A scrollable, sectioned
 * home for everything you configure about one session. Section 1 is Connection &
 * Ports (the existing SSH host + port-forwarding UI). Built so later phases drop in
 * more sections (e.g. Project Management / Jira) as siblings with no rework.
 *
 * Named SessionSettingsPanel to avoid colliding with the app-level SettingsPanel
 * (the connection/appearance modal reached from the title bar).
 */
export default function SessionSettingsPanel({ sessionId, cwd, machine }: { sessionId: string; cwd: string; machine: string }) {
  return (
    <div className="no-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column" }}>
      <Section title="Connection & Ports" hint="SSH host for this session and the ports forwarded to your machine.">
        <PortsPanel sessionId={sessionId} cwd={cwd} machine={machine} />
      </Section>
      <Section title="Project Management" hint="Connect this session to a Jira project — its current-sprint issues assigned to you flow into the Tasks tab.">
        <JiraSettings sessionId={sessionId} />
      </Section>
    </div>
  );
}

/** A titled settings section — consistent framing so future sections line up. */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div style={{ padding: "12px 18px 0" }}>
        <div className="kicker">{title}</div>
        {hint && <div className="faint" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
      </div>
      {children}
    </div>
  );
}
