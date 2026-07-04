import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import NotesMarkdown from "./NotesMarkdown";

type NoteFile = { name: string; path: string };
type ViewMode = "edit" | "split" | "preview";

const SAVE_DEBOUNCE_MS = 800;
const trimSlash = (s: string): string => s.replace(/\/+$/, "");

/** First markdown heading (or first non-empty line) → a Notion-ish page title. */
function deriveTitle(name: string, content: string): string {
  for (const raw of content.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^#{1,6}\s+(.*)$/);
    return (h ? h[1] : line).slice(0, 60);
  }
  return name.replace(/\.md$/i, "");
}

/**
 * Notes — a live markdown editor (mermaid diagrams supported) with a Notion-style
 * page list. Every note is a `.md` file under the focused project's `docs/note`
 * folder on its host (created on first save). Edits autosave over the existing
 * remote file IPC; switching sessions switches to that project's notes.
 */
export default function NotesPanel({ active }: { active: boolean }) {
  const focusId = useStore((s) => s.focusId);
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const session = sessions.find((s) => s.id === focusId) ?? queue.find((s) => s.id === focusId);
  const cwd = session?.cwd ?? null;
  const machine = session?.machine ?? null;
  const docsDir = cwd ? `${trimSlash(cwd)}/docs` : null;
  const notesDir = cwd ? `${trimSlash(cwd)}/docs/note` : null;

  const [notes, setNotes] = useState<NoteFile[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [view, setView] = useState<ViewMode>("split");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [listErr, setListErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  // Latest values mirrored into refs so the unmount flush / note-switch flush read
  // current state without re-subscribing effects on every keystroke.
  const activePathRef = useRef<string | null>(null);
  const contentRef = useRef("");
  activePathRef.current = activePath;
  contentRef.current = content;

  // Ensure docs/note exists (mkdir -p is idempotent). Best-effort; returns ok flag.
  const ensureDir = useCallback(async (): Promise<boolean> => {
    if (!cwd || !machine || !docsDir) return false;
    const r = await window.cowork.makeDir({ cwd, machine, parent: docsDir, name: "note" });
    return !!r.ok;
  }, [cwd, machine, docsDir]);

  const loadNotes = useCallback(async () => {
    if (!cwd || !machine || !notesDir) { setNotes([]); return; }
    const r = await window.cowork.listFiles({ cwd, machine, dir: notesDir });
    if (!r.ok) {
      // Folder likely doesn't exist yet — that's fine, it appears on first note.
      setNotes([]);
      setListErr(null);
      return;
    }
    setListErr(null);
    const md = r.entries.filter((e) => e.kind === "file" && /\.md$/i.test(e.name)).map((e) => ({ name: e.name, path: e.path }));
    md.sort((a, b) => a.name.localeCompare(b.name));
    setNotes(md);
  }, [cwd, machine, notesDir]);

  // Reload the note list whenever the focused project changes or the window opens.
  useEffect(() => {
    setActivePath(null);
    setContent("");
    setTitles({});
    if (active) loadNotes();
  }, [active, cwd, machine, loadNotes]);

  // Open a note (read its content). Flush any pending edits on the current note first
  // so switching pages never loses unsaved changes.
  const openNote = useCallback(
    async (path: string) => {
      if (!cwd || !machine) return;
      if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
      if (activePathRef.current && dirty.current) await doSaveRef.current(activePathRef.current, contentRef.current);
      setActivePath(path);
      setStatus("idle");
      dirty.current = false;
      const r = await window.cowork.readFile({ cwd, machine, file: path });
      if (r.ok && r.encoding === "text") {
        setContent(r.content);
        const name = path.split("/").pop() ?? path;
        setTitles((t) => ({ ...t, [path]: deriveTitle(name, r.content) }));
      } else {
        setContent("");
      }
    },
    [cwd, machine]
  );

  const doSave = useCallback(
    async (path: string, text: string) => {
      if (!cwd || !machine) return;
      setStatus("saving");
      await ensureDir();
      const r = await window.cowork.writeFile({ cwd, machine, file: path, content: text });
      setStatus(r.ok ? "saved" : "error");
      if (r.ok) {
        const name = path.split("/").pop() ?? path;
        setTitles((t) => ({ ...t, [path]: deriveTitle(name, text) }));
      }
    },
    [cwd, machine, ensureDir]
  );
  const doSaveRef = useRef(doSave);
  doSaveRef.current = doSave;

  // Debounced autosave whenever the content of the open note changes.
  const onChange = (text: string) => {
    setContent(text);
    dirty.current = true;
    if (!activePath) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => { doSave(activePath, text); dirty.current = false; }, SAVE_DEBOUNCE_MS);
  };

  // Flush a pending save on unmount ONLY (empty deps) so no edits are lost; reads
  // the latest note/content via refs to avoid re-running this on every keystroke.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (activePathRef.current && dirty.current) doSaveRef.current(activePathRef.current, contentRef.current);
  }, []);

  const newNote = async () => {
    if (!cwd || !machine || !notesDir) return;
    if (!(await ensureDir())) { setListErr("could not create docs/note"); return; }
    const existing = new Set(notes.map((n) => n.name));
    let name = "untitled.md";
    for (let i = 2; existing.has(name); i++) name = `untitled-${i}.md`;
    const r = await window.cowork.createFile({ cwd, machine, parent: notesDir, name });
    if (!r.ok || !r.path) { setListErr(r.error ?? "could not create note"); return; }
    const seed = "# Untitled\n\n";
    await window.cowork.writeFile({ cwd, machine, file: r.path, content: seed });
    await loadNotes();
    setActivePath(r.path);
    setContent(seed);
    setTitles((t) => ({ ...t, [r.path as string]: "Untitled" }));
    setStatus("saved");
  };

  const deleteNote = async (path: string) => {
    if (!cwd || !machine) return;
    await window.cowork.deletePath({ cwd, machine, path });
    setConfirmDel(null);
    if (activePath === path) { setActivePath(null); setContent(""); }
    await loadNotes();
  };

  const titleFor = (n: NoteFile): string => titles[n.path] ?? n.name.replace(/\.md$/i, "");

  const railBtn: React.CSSProperties = {
    border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)",
    borderRadius: 8, padding: "4px 9px", fontSize: 11, fontFamily: "var(--font-mono)", cursor: "pointer",
  };

  if (!session) {
    return <div className="mono faint" style={{ padding: 16, fontSize: 12 }}>Select a session to open its notes.</div>;
  }

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {/* Page list rail */}
      <div style={{ width: 168, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span className="mono" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)", flex: 1 }}>Notes</span>
          <button onClick={newNote} title="New note" style={{ ...railBtn, padding: "3px 8px" }}>＋</button>
        </div>
        <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: 6, display: "flex", flexDirection: "column", gap: 2 }}>
          {notes.length === 0 && (
            <span className="mono faint" style={{ fontSize: 10.5, padding: "6px 8px", lineHeight: 1.5 }}>
              {listErr ?? "No notes yet. Create one — it lands in docs/note."}
            </span>
          )}
          {notes.map((n) => {
            const on = n.path === activePath;
            return (
              <div key={n.path}
                onClick={() => openNote(n.path)}
                style={{
                  display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 7, cursor: "pointer",
                  background: on ? "rgb(var(--primary) / 0.20)" : "transparent",
                  border: on ? "1px solid rgb(var(--primary-soft) / 0.4)" : "1px solid transparent",
                }}>
                <span style={{ fontSize: 11 }}>▢</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={n.name}>
                  {titleFor(n)}
                </span>
                {confirmDel === n.path ? (
                  <span onClick={(e) => { e.stopPropagation(); deleteNote(n.path); }} title="Confirm delete"
                    className="mono" style={{ fontSize: 9, color: "#e0736a" }}>del?</span>
                ) : (
                  <span onClick={(e) => { e.stopPropagation(); setConfirmDel(n.path); }} title="Delete note"
                    style={{ fontSize: 11, opacity: 0.5, color: "var(--text-faint)" }}>✕</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Editor + preview */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {activePath ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              <span className="mono" style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }} title={activePath}>
                {activePath.split("/").pop()}
              </span>
              <span className="mono faint" style={{ fontSize: 9.5, flexShrink: 0 }}>
                {status === "saving" ? "saving…" : status === "saved" ? "✓ saved" : status === "error" ? "save failed" : ""}
              </span>
              <span style={{ flex: 1 }} />
              <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 999, border: "1px solid var(--border)", flexShrink: 0 }}>
                {(["edit", "split", "preview"] as ViewMode[]).map((v) => (
                  <button key={v} onClick={() => setView(v)} style={{
                    padding: "3px 9px", borderRadius: 7, fontFamily: "var(--font-mono)", fontSize: 10, cursor: "pointer", border: 0,
                    background: view === v ? "rgb(var(--primary) / 0.28)" : "transparent", color: view === v ? "#fff" : "var(--text-soft)",
                  }}>{v}</button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
              {view !== "preview" && (
                <textarea
                  value={content}
                  onChange={(e) => onChange(e.target.value)}
                  spellCheck={false}
                  placeholder="# Title&#10;&#10;Write markdown… ```mermaid blocks render on the right."
                  className="no-scrollbar"
                  style={{
                    flex: 1, minWidth: 0, resize: "none", border: "none", outline: "none",
                    background: "transparent", color: "var(--text)", padding: "12px 14px",
                    fontFamily: "var(--font-mono)", fontSize: 12.5, lineHeight: 1.6,
                    borderRight: view === "split" ? "1px solid var(--border)" : undefined,
                  }}
                />
              )}
              {view !== "edit" && (
                <div className="no-scrollbar" style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "10px 16px" }}>
                  {content.trim() ? <NotesMarkdown>{content}</NotesMarkdown> : <span className="mono faint" style={{ fontSize: 11 }}>nothing to preview</span>}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="mono faint" style={{ padding: 18, fontSize: 12, lineHeight: 1.6 }}>
            {notes.length ? "Select a note on the left, or " : "No notes yet — "}
            <span onClick={newNote} style={{ color: "rgb(var(--accent))", cursor: "pointer" }}>create one</span>.
            <div style={{ marginTop: 8, fontSize: 10.5 }}>Saved to <span className="mono" style={{ color: "var(--text-soft)" }}>docs/note</span> on {machine}.</div>
          </div>
        )}
      </div>
    </div>
  );
}
