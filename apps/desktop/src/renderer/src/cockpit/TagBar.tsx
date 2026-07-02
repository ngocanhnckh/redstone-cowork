import { useState } from "react";
import { useStore } from "../store";

/**
 * User-applied tags for a session — small chips with a remove affordance plus an
 * inline "add tag" input. Persisted server-side, so tags survive refreshes and
 * are shared across desktop + web.
 */
export default function TagBar({ sessionId, tags }: { sessionId: string; tags: string[] }) {
  const addTag = useStore((s) => s.addTag);
  const removeTag = useStore((s) => s.removeTag);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  const submit = () => {
    const t = draft.trim();
    if (t) addTag(sessionId, t);
    setDraft("");
    setAdding(false);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
      {tags.map((tag) => (
        <span
          key={tag}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 10.5,
            fontFamily: "var(--font-mono)",
            padding: "3px 8px",
            borderRadius: 999,
            background: "rgb(var(--primary) / 0.14)",
            border: "1px solid rgb(var(--primary-soft) / 0.35)",
            color: "var(--text)",
          }}
        >
          {tag}
          <span
            onClick={() => removeTag(sessionId, tag)}
            title="Remove tag"
            style={{ cursor: "pointer", opacity: 0.6, fontSize: 11, lineHeight: 1 }}
          >
            ✕
          </span>
        </span>
      ))}

      {adding ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            else if (e.key === "Escape") { setDraft(""); setAdding(false); }
          }}
          onBlur={submit}
          placeholder="tag…"
          maxLength={40}
          style={{
            width: 92,
            fontSize: 10.5,
            fontFamily: "var(--font-mono)",
            padding: "3px 8px",
            borderRadius: 999,
            border: "1px solid var(--border-strong)",
            background: "transparent",
            color: "var(--text)",
            outline: "none",
          }}
        />
      ) : (
        <button
          onClick={() => setAdding(true)}
          title="Add a tag"
          style={{
            fontSize: 10.5,
            fontFamily: "var(--font-mono)",
            padding: "3px 8px",
            borderRadius: 999,
            border: "1px dashed var(--border-strong)",
            background: "transparent",
            color: "var(--text-soft)",
            cursor: "pointer",
          }}
        >
          + tag
        </button>
      )}
    </div>
  );
}
