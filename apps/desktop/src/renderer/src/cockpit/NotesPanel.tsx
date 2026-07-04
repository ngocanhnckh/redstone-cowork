import { useCallback, useEffect, useState } from "react";
import { useStore } from "../store";
import NotesEditor from "./NotesEditor";

type NoteFile = { name: string; path: string };

const trimSlash = (s: string): string => s.replace(/\/+$/, "");

/** First markdown heading (or first non-empty line) → a Notion-ish page title. */
function deriveTitle(name: string, markdown: string): string {
  for (const raw of markdown.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^#{1,6}\s+(.*)$/);
    const title = (h ? h[1] : line).replace(/[*_`#>-]/g, "").trim();
    if (title) return title.slice(0, 60);
  }
  return name.replace(/\.md$/i, "");
}

/**
 * Notes — a Notion-style page list backed by `.md` files under the focused
 * project's `docs/note` folder on its host (created on first note). Each page opens
 * in a BlockNote WYSIWYG editor (lists, checklists, tables, code, AI-mermaid) that
 * autosaves markdown back to the file. Switching sessions switches note folders.
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
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [listErr, setListErr] = useState<string | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const ensureDir = useCallback(async (): Promise<boolean> => {
    if (!cwd || !machine || !docsDir) return false;
    const r = await window.cowork.makeDir({ cwd, machine, parent: docsDir, name: "note" });
    return !!r.ok;
  }, [cwd, machine, docsDir]);

  const loadNotes = useCallback(async () => {
    if (!cwd || !machine || !notesDir) { setNotes([]); return; }
    const r = await window.cowork.listFiles({ cwd, machine, dir: notesDir });
    if (!r.ok) { setNotes([]); setListErr(null); return; } // folder not created yet
    setListErr(null);
    const md = r.entries
      .filter((e) => e.kind === "file" && /\.md$/i.test(e.name))
      .map((e) => ({ name: e.name, path: e.path }))
      .sort((a, b) => a.name.localeCompare(b.name));
    setNotes(md);
  }, [cwd, machine, notesDir]);

  // Reload the list whenever the focused project changes or the window opens.
  useEffect(() => {
    setActivePath(null);
    setTitles({});
    setStatus("idle");
    if (active) loadNotes();
  }, [active, cwd, machine, loadNotes]);

  const newNote = async () => {
    if (!cwd || !machine || !notesDir) return;
    if (!(await ensureDir())) { setListErr("could not create docs/note"); return; }
    const existing = new Set(notes.map((n) => n.name));
    let name = "untitled.md";
    for (let i = 2; existing.has(name); i++) name = `untitled-${i}.md`;
    const r = await window.cowork.createFile({ cwd, machine, parent: notesDir, name });
    if (!r.ok || !r.path) { setListErr(r.error ?? "could not create note"); return; }
    await window.cowork.writeFile({ cwd, machine, file: r.path, content: "# Untitled\n\n" });
    setTitles((t) => ({ ...t, [r.path as string]: "Untitled" }));
    await loadNotes();
    setActivePath(r.path);
  };

  const deleteNote = async (path: string) => {
    if (!cwd || !machine) return;
    await window.cowork.deletePath({ cwd, machine, path });
    setConfirmDel(null);
    if (activePath === path) setActivePath(null);
    await loadNotes();
  };

  const onSaved = useCallback((path: string, markdown: string, s: "saving" | "saved" | "error") => {
    setStatus(s);
    if (s === "saved" && markdown) {
      const name = path.split("/").pop() ?? path;
      setTitles((t) => ({ ...t, [path]: deriveTitle(name, markdown) }));
    }
  }, []);

  const titleFor = (n: NoteFile): string => titles[n.path] ?? n.name.replace(/\.md$/i, "");

  const railBtn: React.CSSProperties = {
    border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)",
    borderRadius: 8, padding: "3px 8px", fontSize: 11, fontFamily: "var(--font-mono)", cursor: "pointer",
  };

  if (!session || !cwd || !machine) {
    return <div className="mono faint" style={{ padding: 16, fontSize: 12 }}>Select a session to open its notes.</div>;
  }

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
      {/* Page list rail */}
      <div style={{ width: 172, flexShrink: 0, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <span className="mono" style={{ fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)", flex: 1 }}>Notes</span>
          <button onClick={newNote} title="New note" style={railBtn}>＋</button>
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
                onClick={() => setActivePath(n.path)}
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

      {/* Editor */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {activePath ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              <span className="mono" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }} title={activePath}>
                {activePath.split("/").pop()}
              </span>
              <span style={{ flex: 1 }} />
              <span className="mono faint" style={{ fontSize: 9.5 }}>
                {status === "saving" ? "saving…" : status === "saved" ? "✓ saved" : status === "error" ? "save failed" : ""}
              </span>
            </div>
            <NotesEditor key={activePath} cwd={cwd} machine={machine} path={activePath} sessionId={session.id} onSaved={onSaved} />
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
