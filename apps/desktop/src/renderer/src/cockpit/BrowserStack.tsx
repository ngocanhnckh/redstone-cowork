import { useStore } from "../store";
import MultiBrowser from "./MultiBrowser";

/**
 * Keep-alive browser layer. Every session whose Browser tab has been opened keeps
 * a live <webview> mounted here; we only toggle visibility with `display` (never
 * unmount), so switching tabs or sessions leaves each browser exactly where it
 * was — like background Chrome tabs. Mounted once inside the persistent FocusStage
 * instance, so it survives focus changes within a mode.
 */
export default function BrowserStack({ activeId, active }: { activeId?: string | null; active: boolean }) {
  const openBrowsers = useStore((s) => s.openBrowsers);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const find = (id: string) => sessions.find((s) => s.id === id) ?? queue.find((s) => s.id === id);

  return (
    <div style={{ display: active ? "flex" : "none", flex: active ? 1 : undefined, minHeight: 0, flexDirection: "column" }}>
      {openBrowsers.map((id) => {
        const s = find(id);
        if (!s) return null;
        const show = active && id === activeId;
        return (
          <div key={id} style={{ display: show ? "flex" : "none", flex: show ? 1 : undefined, minHeight: 0, flexDirection: "column" }}>
            <MultiBrowser sessionId={id} cwd={s.cwd} machine={s.machine} />
          </div>
        );
      })}
    </div>
  );
}
