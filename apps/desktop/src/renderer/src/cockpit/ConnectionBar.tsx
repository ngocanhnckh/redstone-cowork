import { useEffect, useState } from "react";

/**
 * A thin connection bar shown atop the Terminal / Browser / Ports tab bodies.
 * Local sessions show "● local (this machine)". Remote sessions show
 * "via ssh <host>" with an inline edit that persists per-machine.
 */
export default function ConnectionBar({
  machine,
  onHostChange,
}: {
  machine: string;
  /** Called after the ssh host is changed + saved, so callers can reconnect. */
  onHostChange?: (host: string) => void;
}) {
  const [host, setHost] = useState<string>(machine);
  const [isLocal, setIsLocal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(machine);

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

  const wrap: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 32px",
    borderBottom: "1px solid var(--border)",
    fontFamily: "var(--font-mono)",
    fontSize: 11,
    color: "var(--text-soft)",
  };

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
    <div style={wrap}>
      <span className="faint">via ssh</span>
      <span style={{ color: "var(--text)" }}>{host}</span>
      <button onClick={() => { setDraft(host); setEditing(true); }} title="Edit ssh host" style={editBtn}>
        ✎
      </button>
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
