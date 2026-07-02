import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { CapItem } from "../types";

type Props = {
  commands: CapItem[];
  onSubmit: () => void;
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string;
};

/**
 * A chat textarea with slash-command autocomplete: typing `/` at the start shows
 * a filtered menu of the host's installed commands (↑/↓ to move, Enter/Tab to
 * insert, Esc to dismiss). Enter otherwise submits (Shift+Enter = newline). The
 * underlying <textarea> ref is forwarded so callers read `.value` as before.
 */
const SlashTextarea = forwardRef<HTMLTextAreaElement, Props>(function SlashTextarea({ commands, onSubmit, placeholder, style, className }, ref) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => localRef.current as HTMLTextAreaElement, []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const filtered = useMemo(() => {
    if (!open) return [];
    const q = query.toLowerCase();
    const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q));
    const contains = commands.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
    return [...starts, ...contains].slice(0, 8);
  }, [open, query, commands]);

  const autoGrow = (el: HTMLTextAreaElement) => { el.style.height = "auto"; el.style.height = Math.min(140, el.scrollHeight) + "px"; };

  const onInput = (el: HTMLTextAreaElement) => {
    autoGrow(el);
    // Only a bare "/token" at the very start of the input triggers the menu.
    const m = el.value.match(/^\/([\w:-]*)$/);
    if (m) { setOpen(true); setQuery(m[1]); setIndex(0); }
    else setOpen(false);
  };

  const complete = (c: CapItem) => {
    const el = localRef.current;
    if (el) { el.value = `/${c.name} `; autoGrow(el); el.focus(); }
    setOpen(false);
  };

  return (
    <div style={{ position: "relative", flex: 1, minWidth: 0, display: "flex" }}>
      {open && filtered.length > 0 && (
        <div className="glass-soft no-scrollbar" style={{ position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0, maxHeight: 260, overflowY: "auto", borderRadius: 12, border: "1px solid var(--border-strong)", padding: 5, zIndex: 40 }}>
          {filtered.map((c, i) => (
            <div key={c.source + c.name} onMouseEnter={() => setIndex(i)} onMouseDown={(e) => { e.preventDefault(); complete(c); }}
              style={{ padding: "7px 10px", borderRadius: 8, cursor: "pointer", background: i === index ? "rgb(var(--primary) / 0.22)" : "transparent" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span className="mono" style={{ fontSize: 12.5, color: "rgb(var(--accent))" }}>/{c.name}</span>
                <span style={{ flex: 1 }} />
                <span className="mono faint" style={{ fontSize: 9 }}>{c.source}</span>
              </div>
              {c.description && <div className="faint" style={{ fontSize: 10.5, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.description}</div>}
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={localRef}
        className={className}
        placeholder={placeholder}
        rows={1}
        onInput={(e) => onInput(e.currentTarget)}
        onKeyDown={(e) => {
          if (open && filtered.length > 0) {
            if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(filtered.length - 1, i + 1)); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); complete(filtered[index]); return; }
            if (e.key === "Escape") { setOpen(false); return; }
          }
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); }
        }}
        style={style}
      />
    </div>
  );
});

export default SlashTextarea;
