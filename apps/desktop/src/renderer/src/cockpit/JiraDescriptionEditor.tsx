import { Component, forwardRef, type ReactNode, useEffect, useImperativeHandle, useRef } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { markdownToJira } from "./jiraMarkup";

export type JiraDescriptionHandle = {
  /** Current editor content serialized to Jira wiki markup (for PUT on save). */
  getMarkup: () => Promise<string>;
};

/** Blend BlockNote into the modal: transparent surface, theme text colour, and a
 * comfortable min-height so short descriptions still give room to type. */
const CSS = `
  .jira-desc .bn-container, .jira-desc .bn-editor { background: transparent; }
  .jira-desc .bn-container { --bn-colors-editor-background: transparent; --bn-colors-editor-text: var(--text); }
  .jira-desc .ProseMirror { background: transparent; min-height: 160px; padding-inline: 0; }
`;

/** Keep an editor render error from taking down the whole modal. */
class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(e: unknown) { return { error: e instanceof Error ? e.message : String(e) }; }
  render() {
    if (this.state.error) return <div className="mono" style={{ padding: 10, fontSize: 11.5, color: "#e0736a" }}>The editor hit an error: {this.state.error}</div>;
    return this.props.children;
  }
}

/**
 * WYSIWYG editor for a Jira issue description. Seeds from the issue's rendered
 * HTML (so existing formatting shows as editable blocks), and serializes back to
 * Jira wiki markup on demand via `getMarkup()` (exposed through the ref). Reports
 * user edits through `onDirty` so the modal only PUTs the description when changed.
 */
const JiraDescriptionEditor = forwardRef<JiraDescriptionHandle, { html: string; onDirty: () => void }>(
  function JiraDescriptionEditor({ html, onDirty }, ref) {
    const editor = useCreateBlockNote();
    const loaded = useRef(false);

    // Seed the editor from the rendered HTML once (empty → a blank paragraph).
    useEffect(() => {
      let alive = true;
      (async () => {
        try {
          if (html && html.trim()) {
            const blocks = await editor.tryParseHTMLToBlocks(html);
            if (alive && blocks.length) editor.replaceBlocks(editor.document, blocks);
          }
        } catch {
          /* seeding failed — start from the blank doc */
        } finally {
          if (alive) loaded.current = true;
        }
      })();
      return () => { alive = false; };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [editor]);

    useImperativeHandle(ref, () => ({
      getMarkup: async () => {
        const md = await editor.blocksToMarkdownLossy(editor.document);
        return markdownToJira(md);
      },
    }), [editor]);

    return (
      <>
        <style>{CSS}</style>
        <Boundary>
          <div
            className="jira-desc"
            style={{ border: "1px solid var(--border-strong)", borderRadius: 8, padding: "8px 12px", background: "rgba(0,0,0,0.18)", maxHeight: 340, overflowY: "auto" }}
          >
            <BlockNoteView
              editor={editor}
              theme="dark"
              onChange={() => { if (loaded.current) onDirty(); }}
            />
          </div>
        </Boundary>
      </>
    );
  },
);

export default JiraDescriptionEditor;
