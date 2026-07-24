import { forwardRef, useImperativeHandle, useMemo, useRef, useState } from "react";
import { CapItem } from "../types";

type Props = {
  commands: CapItem[];
  onSubmit: () => void;
  placeholder?: string;
  style?: React.CSSProperties;
  className?: string;
  /** Session host + working dir — enables paste/drop/attach file upload into the chat. */
  machine?: string;
  cwd?: string;
};

/**
 * A chat textarea with slash-command autocomplete: typing `/` at the start shows
 * a filtered menu of the host's installed commands (↑/↓ to move, Enter/Tab to
 * insert, Esc to dismiss). Enter otherwise submits (Shift+Enter = newline). The
 * underlying <textarea> ref is forwarded so callers read `.value` as before.
 */
const SlashTextarea = forwardRef<HTMLTextAreaElement, Props>(function SlashTextarea({ commands, onSubmit, placeholder, style, className, machine, cwd }, ref) {
  const localRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => localRef.current as HTMLTextAreaElement, []);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [uploading, setUploading] = useState(0); // in-flight upload count
  const [dragOver, setDragOver] = useState(false);
  const [note, setNote] = useState("");
  const canAttach = !!machine && !!cwd;

  // Insert text at the cursor of the (uncontrolled) textarea, keeping height in sync.
  const insertAtCursor = (text: string) => {
    const el = localRef.current;
    if (!el) return;
    const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, s) + text + el.value.slice(e);
    const pos = s + text.length;
    el.selectionStart = el.selectionEnd = pos;
    autoGrow(el);
    el.focus();
  };

  // Upload a pasted/dropped/picked file to the session host (<cwd>/.rcw-uploads/…) and
  // drop the ABSOLUTE path into the message so Claude (running in cwd) can read it.
  const uploadFile = async (file: File) => {
    if (!machine || !cwd || file.size > 25 * 1024 * 1024) { if (file.size > 25 * 1024 * 1024) setNote("file too large (>25MB)"); return; }
    setUploading((n) => n + 1); setNote("");
    try {
      const dataUrl: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(new Error("read failed")); r.readAsDataURL(file); });
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const ext = ((file.name.split(".").pop() || file.type.split("/")[1] || "bin")).replace(/[^\w]/g, "").slice(0, 8) || "bin";
      const base = (file.name.replace(/\.[^.]+$/, "") || "pasted").replace(/[^\w.-]+/g, "_").slice(0, 40);
      const rel = `.rcw-uploads/${base}-${Date.now()}.${ext}`;
      const r = await window.cowork.writeFileBase64({ cwd, machine, file: rel, base64 });
      if (!r.ok) throw new Error(r.error || "upload failed");
      insertAtCursor(`${cwd.replace(/\/$/, "")}/${rel} `);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "upload failed");
    } finally {
      setUploading((n) => Math.max(0, n - 1));
    }
  };
  const uploadFiles = (files: FileList | File[]) => { const arr = Array.from(files); if (arr.length) void Promise.all(arr.map(uploadFile)); };

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
        <div className="no-scrollbar" style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 0, maxHeight: 260, overflowY: "auto",
          borderRadius: 12, border: "1px solid var(--border-strong)", padding: 5, zIndex: 40,
          // Heavily-blurred, mostly-opaque backdrop so the command text stays readable
          // over whatever's behind (chat, terminal, glass).
          background: "color-mix(in srgb, var(--app-panel, #1b1712) 92%, transparent)",
          WebkitBackdropFilter: "blur(28px) saturate(1.4)",
          backdropFilter: "blur(28px) saturate(1.4)",
          boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
        }}>
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
        onPaste={(e) => { if (canAttach && e.clipboardData.files.length) { e.preventDefault(); uploadFiles(e.clipboardData.files); } }}
        onDragOver={(e) => { if (canAttach && e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragOver(true); } }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { setDragOver(false); if (canAttach && e.dataTransfer.files.length) { e.preventDefault(); uploadFiles(e.dataTransfer.files); } }}
        onKeyDown={(e) => {
          if (open && filtered.length > 0) {
            if (e.key === "ArrowDown") { e.preventDefault(); setIndex((i) => Math.min(filtered.length - 1, i + 1)); return; }
            if (e.key === "ArrowUp") { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); return; }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); complete(filtered[index]); return; }
            if (e.key === "Escape") { setOpen(false); return; }
          }
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); }
        }}
        style={{ ...style, ...(dragOver ? { outline: "2px dashed rgb(var(--accent))", outlineOffset: -2 } : null) }}
      />
      {canAttach && (
        <>
          <input ref={fileRef} type="file" multiple style={{ display: "none" }}
            onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ""; }} />
          <button type="button" title="Attach a file — uploads to the session host and inserts its path"
            onMouseDown={(e) => { e.preventDefault(); fileRef.current?.click(); }}
            style={{ position: "absolute", right: 8, bottom: 8, width: 26, height: 26, borderRadius: 7, cursor: "pointer",
              border: "1px solid var(--border)", background: "rgb(var(--primary) / 0.08)", color: "rgb(var(--primary-soft))",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 }}>
            {uploading > 0 ? "…" : "📎"}
          </button>
        </>
      )}
      {(uploading > 0 || note) && (
        <div className="mono" style={{ position: "absolute", left: 4, bottom: "calc(100% + 4px)", fontSize: 10, letterSpacing: ".04em",
          color: note ? "#e0736a" : "rgb(var(--accent))" }}>
          {uploading > 0 ? `↑ uploading ${uploading} file${uploading > 1 ? "s" : ""}…` : note}
        </div>
      )}
    </div>
  );
});

export default SlashTextarea;
