import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems } from "@blocknote/core";
import {
  createReactBlockSpec,
  getDefaultReactSlashMenuItems,
  SuggestionMenuController,
  useCreateBlockNote,
} from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import MermaidView from "./Mermaid";

const SAVE_DEBOUNCE_MS = 700;

// The focused session id (for the AI mermaid generator) is passed to the custom
// block via context, since block render functions don't take external props.
const NotesAIContext = createContext<{ sessionId: string | null }>({ sessionId: null });

/** Ask the assistant model for mermaid source describing `prompt`; strips fences. */
async function generateMermaid(sessionId: string, prompt: string): Promise<string> {
  const input =
    `Generate a Mermaid diagram for the following request. Output ONLY valid Mermaid ` +
    `code — no markdown fences, no prose, no explanation.\n\nRequest: ${prompt}`;
  const out = await window.cowork.llmAssist({ sessionId, kind: "chat", input });
  return out
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

/** Interactive mermaid block: render the diagram, edit the code, or AI-generate it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MermaidBlockView({ block, editor }: { block: { props: { code: string } }; editor: any }) {
  const { sessionId } = useContext(NotesAIContext);
  const code: string = block.props.code ?? "";
  const [editing, setEditing] = useState(!code.trim());
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setCode = (next: string) => editor.updateBlock(block, { type: "mermaid", props: { code: next } });

  const runAi = async () => {
    if (!prompt.trim() || busy) return;
    if (!sessionId) { setErr("no session selected for the AI model"); return; }
    setBusy(true);
    setErr(null);
    try {
      const generated = await generateMermaid(sessionId, prompt.trim());
      if (generated) { setCode(generated); setEditing(true); }
      else setErr("the model returned nothing");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div contentEditable={false} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "rgb(var(--primary) / 0.04)", margin: "4px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)" }}>◈ mermaid</span>
        <span style={{ flex: 1 }} />
        <button onClick={() => setEditing((e) => !e)} style={miniBtn}>{editing ? "hide code" : "edit code"}</button>
      </div>

      {/* AI prompt row */}
      <div style={{ display: "flex", gap: 6, marginBottom: editing || code.trim() ? 8 : 0 }}>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runAi(); } }}
          placeholder="Describe a diagram → AI writes the mermaid…"
          style={{ flex: 1, minWidth: 0, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", borderRadius: 8, padding: "5px 9px", fontSize: 12, outline: "none" }}
        />
        <button onClick={runAi} disabled={busy || !prompt.trim()} style={{ ...miniBtn, opacity: busy || !prompt.trim() ? 0.5 : 1 }}>
          {busy ? "…" : "✦ generate"}
        </button>
      </div>
      {err && <div className="mono" style={{ color: "#e0736a", fontSize: 10.5, marginBottom: 6 }}>{err}</div>}

      {editing && (
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          spellCheck={false}
          placeholder="graph TD; A-->B;"
          style={{ width: "100%", boxSizing: "border-box", minHeight: 96, resize: "vertical", border: "1px solid var(--border)", background: "rgba(255,255,255,0.03)", color: "var(--text)", borderRadius: 8, padding: "8px 10px", fontFamily: "var(--font-mono)", fontSize: 12, lineHeight: 1.5, outline: "none", marginBottom: 8 }}
        />
      )}

      {code.trim() && (
        <div style={{ padding: 6, borderRadius: 8, background: "rgba(0,0,0,0.15)", overflowX: "auto" }}>
          <MermaidView code={code} />
        </div>
      )}
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)",
  borderRadius: 7, padding: "3px 9px", fontSize: 10.5, fontFamily: "var(--font-mono)", cursor: "pointer",
};

// Custom "mermaid" block — atomic (no inline content), stores its source in a prop.
// createReactBlockSpec returns a factory in this BlockNote version, so we call it.
const MermaidBlockSpec = createReactBlockSpec(
  { type: "mermaid", propSchema: { code: { default: "" } }, content: "none" },
  { render: (props) => <MermaidBlockView block={props.block as { props: { code: string } }} editor={props.editor} /> },
);

const schema = BlockNoteSchema.create({
  blockSpecs: { ...defaultBlockSpecs, mermaid: MermaidBlockSpec() },
});

// ---- markdown <-> blocks bridge (mermaid block ⇄ ```mermaid fence) -----------
// BlockNote's generics are heavy; the bridge works at the value level, so we type
// the editor loosely here and keep the strong typing at the component boundary.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function docToMarkdown(editor: any): Promise<string> {
  const parts: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let run: any[] = [];
  const flush = async () => {
    if (!run.length) return;
    const md = (await editor.blocksToMarkdownLossy(run)).trim();
    if (md) parts.push(md);
    run = [];
  };
  for (const b of editor.document) {
    if (b.type === "mermaid") {
      await flush();
      parts.push("```mermaid\n" + String(b.props?.code ?? "").trim() + "\n```");
    } else {
      run.push(b);
    }
  }
  await flush();
  return parts.filter(Boolean).join("\n\n") + "\n";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function markdownToBlocks(editor: any, md: string): Promise<any[]> {
  const blocks = await editor.tryParseMarkdownToBlocks(md);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (blocks as any[]).map((b) => {
    if (b.type === "codeBlock" && b.props?.language === "mermaid") {
      const code = (b.content ?? []).map((c: { type: string; text?: string }) => (c.type === "text" ? c.text ?? "" : "")).join("");
      return { type: "mermaid", props: { code } };
    }
    return b;
  });
}

/**
 * A Notion-style WYSIWYG editor (BlockNote) for one note. Loads the note's markdown
 * from its remote file, renders it as editable blocks — bullet & numbered lists,
 * checklists, tables, code blocks, headings, and an AI-assisted mermaid block — and
 * autosaves back to the same file as markdown. Keyed by `path` so switching notes
 * remounts with fresh content.
 */
export default function NotesEditor({
  cwd, machine, path, sessionId, onSaved,
}: {
  cwd: string;
  machine: string;
  path: string;
  sessionId: string | null;
  onSaved: (path: string, markdown: string, status: "saving" | "saved" | "error") => void;
}) {
  const editor = useCreateBlockNote({ schema });
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const docsDir = useMemo(() => `${cwd.replace(/\/+$/, "")}/docs`, [cwd]);

  // Load the note's markdown into the editor once.
  useEffect(() => {
    let alive = true;
    loaded.current = false;
    (async () => {
      try {
        const r = await window.cowork.readFile({ cwd, machine, file: path });
        const md = r.ok && r.encoding === "text" ? r.content : "";
        const blocks = await markdownToBlocks(editor, md);
        if (!alive) return;
        if (blocks.length) editor.replaceBlocks(editor.document, blocks);
        setLoadErr(r.ok ? null : (r as { error?: string }).error ?? null);
      } catch (e) {
        if (alive) setLoadErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) loaded.current = true;
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, cwd, machine, path]);

  const save = async () => {
    try {
      const md = await docToMarkdown(editor);
      onSaved(path, md, "saving");
      await window.cowork.makeDir({ cwd, machine, parent: docsDir, name: "note" });
      const r = await window.cowork.writeFile({ cwd, machine, file: path, content: md });
      onSaved(path, md, r.ok ? "saved" : "error");
    } catch {
      onSaved(path, "", "error");
    }
  };

  const scheduleSave = () => {
    if (!loaded.current) return; // ignore the programmatic load
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, SAVE_DEBOUNCE_MS);
  };

  // Flush a pending save on unmount / note switch so no edits are lost.
  useEffect(() => () => { if (saveTimer.current) { clearTimeout(saveTimer.current); save(); } },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path]);

  return (
    <NotesAIContext.Provider value={{ sessionId }}>
      <div className="notes-editor" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {loadErr && <div className="mono" style={{ color: "#e0736a", fontSize: 11, padding: "8px 12px" }}>could not read note: {loadErr}</div>}
        <BlockNoteView editor={editor} theme="dark" onChange={scheduleSave} slashMenu={false}>
          <SuggestionMenuController
            triggerCharacter="/"
            getItems={async (query) =>
              filterSuggestionItems(
                [
                  ...getDefaultReactSlashMenuItems(editor),
                  {
                    title: "Mermaid diagram",
                    subtext: "AI-assisted flow / sequence / graph",
                    group: "Advanced",
                    onItemClick: () => {
                      const ref = editor.getTextCursorPosition().block;
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      editor.insertBlocks([{ type: "mermaid" } as any], ref, "after");
                    },
                  },
                ],
                query,
              )
            }
          />
        </BlockNoteView>
      </div>
    </NotesAIContext.Provider>
  );
}
