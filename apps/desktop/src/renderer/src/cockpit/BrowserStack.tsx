import { useStore } from "../store";
import MultiBrowser from "./MultiBrowser";

/**
 * Browser layer. Every session whose Browser tab has been opened keeps its
 * MultiBrowser mounted here, toggled with `display`, so switching sessions leaves
 * each browser exactly where it was — like background Chrome tabs. Each
 * MultiBrowser is told whether it is the layer actually on screen (`visible`) and
 * discards the <webview> of tabs nobody is looking at (see `tabDiscard.ts`) —
 * otherwise every tab of every session stays a live Chromium guest and the GPU
 * runs out of tile memory. Mounted once inside the persistent FocusStage instance,
 * so it survives focus changes within a mode.
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
            <MultiBrowser sessionId={id} cwd={s.cwd} machine={s.machine} visible={show} />
          </div>
        );
      })}
    </div>
  );
}
