import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * The subset of Electron's <webview> `context-menu` event params we use. The event
 * fires with `params` describing what was right-clicked (a link, editable field,
 * selection, image) and the click position in the guest's coordinate space.
 */
export type WebviewContextParams = {
  x: number;
  y: number;
  linkURL?: string;
  linkText?: string;
  srcURL?: string;
  pageURL?: string;
  selectionText?: string;
  isEditable?: boolean;
  mediaType?: string;
  editFlags?: {
    canCut?: boolean;
    canCopy?: boolean;
    canPaste?: boolean;
    canSelectAll?: boolean;
  };
};

/** Where the menu opened (window coords) + what was clicked. */
export type CtxMenuState = { x: number; y: number; params: WebviewContextParams } | null;

/** Imperative <webview> methods the menu drives. */
export type CtxMenuTarget = {
  goBack(): void;
  goForward(): void;
  reload(): void;
  cut(): void;
  copy(): void;
  paste(): void;
  selectAll(): void;
  inspectElement(x: number, y: number): void;
};

type Item =
  | { kind: "sep" }
  | { kind: "item"; label: string; hint?: string; onClick: () => void; disabled?: boolean };

interface Props {
  state: NonNullable<CtxMenuState>;
  target: CtxMenuTarget | null;
  onOpenInNewTab: (url: string) => void;
  onOpenExternal: (url: string) => void;
  onClose: () => void;
}

/**
 * A themed right-click menu for the workspace <webview>, replacing the absent
 * native menu. Items adapt to what was clicked (link / editable field / selection
 * / image). Positioned at the click point (clamped into the viewport), it closes
 * on any outside click, scroll, Escape, or blur.
 */
export default function BrowserContextMenu({ state, target, onOpenInNewTab, onOpenExternal, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { params } = state;
  // Final on-screen position — starts at the click, then nudged so the menu stays
  // fully within the window once its size is known.
  const [pos, setPos] = useState({ x: state.x, y: state.y });

  const write = (text: string) => { window.cowork.copyText(text).catch(() => {}); };

  const link = params.linkURL?.trim();
  const img = params.mediaType === "image" ? params.srcURL?.trim() : undefined;
  const sel = params.selectionText?.trim();
  const editable = !!params.isEditable;
  const ef = params.editFlags ?? {};

  const run = (fn: () => void) => { fn(); onClose(); };

  const items: Item[] = [];
  if (link) {
    items.push({ kind: "item", label: "Open link in new tab", onClick: () => run(() => onOpenInNewTab(link)) });
    items.push({ kind: "item", label: "Open link in real browser", onClick: () => run(() => onOpenExternal(link)) });
    items.push({ kind: "item", label: "Copy link address", onClick: () => run(() => write(link)) });
    items.push({ kind: "sep" });
  }
  if (img) {
    items.push({ kind: "item", label: "Open image in new tab", onClick: () => run(() => onOpenInNewTab(img)) });
    items.push({ kind: "item", label: "Copy image address", onClick: () => run(() => write(img)) });
    items.push({ kind: "sep" });
  }
  if (editable) {
    items.push({ kind: "item", label: "Cut", hint: "⌘X", disabled: !ef.canCut, onClick: () => run(() => target?.cut()) });
    items.push({ kind: "item", label: "Copy", hint: "⌘C", disabled: !ef.canCopy, onClick: () => run(() => target?.copy()) });
    items.push({ kind: "item", label: "Paste", hint: "⌘V", disabled: !ef.canPaste, onClick: () => run(() => target?.paste()) });
    items.push({ kind: "item", label: "Select all", hint: "⌘A", disabled: !ef.canSelectAll, onClick: () => run(() => target?.selectAll()) });
    items.push({ kind: "sep" });
  } else if (sel) {
    items.push({ kind: "item", label: "Copy", hint: "⌘C", onClick: () => run(() => (target ? target.copy() : write(sel))) });
    items.push({ kind: "sep" });
  }
  items.push({ kind: "item", label: "Back", hint: "⌘[", onClick: () => run(() => target?.goBack()) });
  items.push({ kind: "item", label: "Forward", hint: "⌘]", onClick: () => run(() => target?.goForward()) });
  items.push({ kind: "item", label: "Reload", hint: "⌘R", onClick: () => run(() => target?.reload()) });
  items.push({ kind: "sep" });
  items.push({ kind: "item", label: "Inspect element", onClick: () => run(() => target?.inspectElement(params.x, params.y)) });

  // Close on any outside interaction.
  useEffect(() => {
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    // Capture-phase pointerdown so a click anywhere (including a webview) closes it.
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  // Clamp into the viewport once the menu has laid out (so it never spills offscreen).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 8;
    const x = Math.min(state.x, window.innerWidth - width - pad);
    const y = Math.min(state.y, window.innerHeight - height - pad);
    setPos({ x: Math.max(pad, x), y: Math.max(pad, y) });
  }, [state.x, state.y]);

  return (
    <div
      ref={ref}
      className="glass-surface no-scrollbar"
      // Stop the menu's own pointerdown from bubbling to the window closer above.
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        position: "fixed", left: pos.x, top: pos.y, zIndex: 9999,
        minWidth: 210, maxWidth: 300, padding: 6, borderRadius: 12,
        border: "1px solid var(--border)", boxShadow: "0 16px 44px rgba(0,0,0,0.5)",
        fontFamily: "var(--font-body)",
      }}
    >
      {items.map((it, i) =>
        it.kind === "sep" ? (
          <div key={i} style={{ height: 1, background: "var(--border)", margin: "5px 6px", opacity: 0.6 }} />
        ) : (
          <div
            key={i}
            className={it.disabled ? undefined : "glass-inset-hover"}
            onClick={it.disabled ? undefined : it.onClick}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
              padding: "7px 10px", borderRadius: 8, fontSize: 12.5,
              cursor: it.disabled ? "default" : "pointer",
              color: it.disabled ? "var(--text-faint)" : "var(--text)",
              opacity: it.disabled ? 0.5 : 1,
            }}
          >
            <span>{it.label}</span>
            {it.hint && <span className="mono faint" style={{ fontSize: 10.5 }}>{it.hint}</span>}
          </div>
        )
      )}
    </div>
  );
}
