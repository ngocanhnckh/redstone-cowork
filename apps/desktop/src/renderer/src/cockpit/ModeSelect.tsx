import { useStore } from "../store";
import { SessionView } from "../types";

const MODES = ["default", "acceptEdits", "plan", "auto"] as const;
const LABEL: Record<string, string> = { default: "Default", acceptEdits: "Accept Edits", plan: "Plan", auto: "Auto" };

/** Compact permission-mode dropdown (cycles Shift+Tab modes) for a session. */
export default function ModeSelect({ session }: { session: SessionView }) {
  const switchMode = useStore((s) => s.switchMode);
  const current = session.permissionMode && (MODES as readonly string[]).includes(session.permissionMode) ? session.permissionMode : "default";
  return (
    <select
      value={current}
      onChange={(e) => switchMode(session.id, e.target.value)}
      title="Permission mode"
      style={{
        fontFamily: "var(--font-mono)", fontSize: 11, padding: "3px 6px", borderRadius: 7,
        border: "1px solid var(--border)", background: "rgb(var(--primary) / 0.14)", color: "var(--text)",
        outline: "none", cursor: "pointer",
      }}
    >
      {MODES.map((m) => <option key={m} value={m}>{LABEL[m]}</option>)}
    </select>
  );
}
