import { useStore } from "../store";
import MultiTerminal from "./MultiTerminal";

/**
 * Keep-alive terminal layer. Every session whose terminal has been opened keeps
 * its MultiTerminal (and every PTY tab inside it) mounted here; we only toggle
 * visibility with `display` (never unmount), so switching sessions leaves each
 * terminal exactly as it was — live shells, extra tabs, scrollback and all —
 * like background tabs. Mirrors BrowserStack.
 */
export default function TerminalStack({ activeId, active }: { activeId?: string | null; active: boolean }) {
  const openTerminals = useStore((s) => s.openTerminals);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const find = (id: string) => sessions.find((s) => s.id === id) ?? queue.find((s) => s.id === id);

  return (
    <div style={{ display: active ? "flex" : "none", flex: active ? 1 : undefined, minHeight: 0, flexDirection: "column" }}>
      {openTerminals.map((id) => {
        const s = find(id);
        if (!s) return null;
        const show = active && id === activeId;
        return (
          <div key={id} style={{ display: show ? "flex" : "none", flex: show ? 1 : undefined, minHeight: 0, flexDirection: "column" }}>
            <MultiTerminal sessionId={id} cwd={s.cwd} machine={s.machine} />
          </div>
        );
      })}
    </div>
  );
}
