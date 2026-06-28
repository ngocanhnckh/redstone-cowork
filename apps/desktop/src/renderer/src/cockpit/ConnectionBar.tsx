import { useEffect, useState } from "react";

/**
 * A thin connection bar shown atop the Terminal / Browser / Ports tab bodies.
 * Local sessions show "● local (this machine)". Remote sessions show
 * "via ssh <host>" with an inline edit that persists per-machine, plus a
 * one-click "Set up SSH" that provisions passwordless key auth via the agent.
 */
export default function ConnectionBar({
  sessionId,
  machine,
  onHostChange,
}: {
  sessionId: string;
  machine: string;
  /** Called after the ssh host is changed + saved, so callers can reconnect. */
  onHostChange?: (host: string) => void;
}) {
  const [host, setHost] = useState<string>(machine);
  const [isLocal, setIsLocal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(machine);

  // SSH setup flow state.
  const [setupBusy, setSetupBusy] = useState(false);
  const [setupStatus, setSetupStatus] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupDone, setSetupDone] = useState<string | null>(null);
  const [needHost, setNeedHost] = useState(false);
  const [hostDraft, setHostDraft] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([window.cowork.getSshHost(machine), window.cowork.isLocalMachine(machine)])
      .then(([h, local]) => {
        if (cancelled) return;
        setHost(h);
        setDraft(h);
        setIsLocal(local);
      })
      .catch(() => {
        /* ignore — keep default */
      });
    return () => {
      cancelled = true;
    };
  }, [machine]);

  async function save() {
    const next = draft.trim() || machine;
    const changed = next !== host;
    try {
      await window.cowork.setSshHost(machine, next);
    } catch {
      /* ignore */
    }
    setHost(next);
    setEditing(false);
    if (changed) onHostChange?.(next);
  }

  async function runSetup(hostNameOverride?: string) {
    setSetupBusy(true);
    setSetupError(null);
    setSetupDone(null);
    setNeedHost(false);
    setSetupStatus("Setting up…");
    let result: SshSetupResult;
    try {
      result = await window.cowork.sshSetup({ sessionId, machine, hostNameOverride });
    } catch (e) {
      setSetupBusy(false);
      setSetupStatus(null);
      setSetupError(e instanceof Error ? e.message : String(e));
      return;
    }
    setSetupBusy(false);
    setSetupStatus(null);

    if (result.stage === "need-host") {
      setNeedHost(true);
      return;
    }
    if (result.stage === "done" && result.ok) {
      setSetupDone(`connected at ${result.hostName}`);
      // Refresh the displayed host + trigger reconnect.
      try {
        const h = await window.cowork.getSshHost(machine);
        setHost(h);
        setDraft(h);
      } catch {
        /* ignore */
      }
      onHostChange?.(machine);
      return;
    }
    // keygen | authorize | done-but-failed
    setSetupError(result.ok ? "setup failed" : result.error || "setup failed");
  }

  const wrap: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 32px",
    borderBottom: "1px solid var(--border)",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: "var(--text-soft)",
    flexWrap: "wrap",
  };

  // Shared "Set up SSH" affordance for remote sessions (hidden while editing host).
  const setupControls = !isLocal ? (
    <>
      <span style={{ flex: 1 }} />
      {setupBusy ? (
        <span className="faint">{setupStatus}</span>
      ) : (
        <button
          onClick={() => runSetup()}
          title="Generate a key, authorize it via the agent, and configure ssh"
          style={editBtn}
        >
          Set up SSH
        </button>
      )}
      {setupDone && <span style={{ color: "rgb(var(--accent))" }}>✓ {setupDone}</span>}
      {setupError && (
        <span style={{ color: "#e0736a", whiteSpace: "pre-wrap", fontSize: 10.5 }}>
          {setupError}
        </span>
      )}
    </>
  ) : null;

  // Need-host prompt row (NAT / no detected address).
  const needHostRow = needHost ? (
    <div style={{ ...wrap, paddingTop: 0, borderBottom: "none" }}>
      <span className="faint">SSH address / IP</span>
      <input
        autoFocus
        value={hostDraft}
        onChange={(e) => setHostDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && hostDraft.trim()) runSetup(hostDraft.trim());
          if (e.key === "Escape") setNeedHost(false);
        }}
        placeholder="e.g. 203.0.113.4"
        style={{
          flex: "0 1 240px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          padding: "4px 9px",
          color: "var(--text)",
          caretColor: "rgb(var(--primary-soft))",
          fontSize: 11,
          background: "rgba(255,255,255,0.03)",
          outline: "none",
          fontFamily: "var(--font-mono)",
        }}
      />
      <button
        onClick={() => hostDraft.trim() && runSetup(hostDraft.trim())}
        style={{ ...editBtn, color: "rgb(var(--accent))" }}
      >
        Confirm
      </button>
      <button onClick={() => setNeedHost(false)} style={editBtn}>
        Cancel
      </button>
    </div>
  ) : null;

  const helper = !isLocal ? (
    <div style={{ ...wrap, paddingTop: 0, paddingBottom: 8, borderBottom: "none" }}>
      <span className="faint" style={{ fontSize: 10 }}>
        Requires a running <code>redstone claude</code> session on this host.
      </span>
    </div>
  ) : null;

  if (isLocal && !editing) {
    return (
      <div style={wrap}>
        <span style={{ color: "rgb(var(--accent))" }}>●</span>
        <span className="faint">local (this machine)</span>
        <button
          onClick={() => {
            setDraft(host);
            setEditing(true);
          }}
          title="Connect via ssh instead"
          style={editBtn}
        >
          via ssh…
        </button>
      </div>
    );
  }

  if (editing) {
    return (
      <div style={wrap}>
        <span className="faint">via ssh</span>
        <input
          autoFocus
          className="reply-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") {
              setDraft(host);
              setEditing(false);
            }
          }}
          placeholder={machine}
          style={{
            flex: "0 1 240px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            padding: "4px 9px",
            color: "var(--text)",
            caretColor: "rgb(var(--primary-soft))",
            fontSize: 11,
            background: "rgba(255,255,255,0.03)",
            outline: "none",
            fontFamily: "var(--font-mono)",
          }}
        />
        <button onClick={save} style={{ ...editBtn, color: "rgb(var(--accent))" }}>
          Save
        </button>
        <button
          onClick={() => {
            setDraft(host);
            setEditing(false);
          }}
          style={editBtn}
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div>
      <div style={wrap}>
        <span className="faint">via ssh</span>
        <span style={{ color: "var(--text)" }}>{host}</span>
        <button
          onClick={() => {
            setDraft(host);
            setEditing(true);
          }}
          title="Edit ssh host"
          style={editBtn}
        >
          ✎
        </button>
        {setupControls}
      </div>
      {needHostRow}
      {helper}
    </div>
  );
}

const editBtn: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-soft)",
  borderRadius: 7,
  padding: "2px 8px",
  fontSize: 10.5,
  fontFamily: "var(--font-mono)",
  cursor: "pointer",
};
