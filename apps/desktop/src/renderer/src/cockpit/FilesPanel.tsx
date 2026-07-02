import { useEffect, useState, useCallback } from "react";
import Editor from "@monaco-editor/react";
import ConnectionBar from "./ConnectionBar";
import Markdown from "./Markdown";
import { ensureMonaco, languageForFile, RCW_MONACO_THEME } from "./monaco-setup";

interface Props {
  sessionId: string;
  cwd: string;
  machine: string;
}

ensureMonaco();

function baseName(p: string): string {
  return p.split("/").filter(Boolean).pop() ?? p;
}
function isMarkdown(name: string): boolean {
  return /\.(md|markdown)$/i.test(name);
}
function humanSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** What was right-clicked. `parent` is the dir new folders / uploads act on. */
type MenuTarget =
  | { kind: "file" | "dir"; path: string; parent: string }
  | { kind: "root"; path: string; parent: string };

/**
 * Copy text to the clipboard from the renderer. Uses the legacy execCommand path
 * (a hidden, selected textarea) which works in Electron under file:// where
 * navigator.clipboard is often unavailable, and needs no IPC / main restart.
 */
function copyToClipboard(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export default function FilesPanel({ sessionId, cwd, machine }: Props) {
  // Tree: loaded entries per directory + expanded set. Lazy-loaded on expand.
  const [tree, setTree] = useState<Record<string, DirEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [treeError, setTreeError] = useState<string | null>(null);

  // Open file + its on-disk text + per-file unsaved drafts.
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [read, setRead] = useState<FileRead | null>(null);
  const [original, setOriginal] = useState<string>("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reading, setReading] = useState(false);
  const [mdMode, setMdMode] = useState<"edit" | "preview">("preview");
  const [saveState, setSaveState] = useState<{ kind: "idle" | "saving" | "ok" | "err"; text?: string }>({ kind: "idle" });
  // Auto-save preference persists across sessions (global, localStorage).
  const [autoSave, setAutoSave] = useState<boolean>(() => {
    try {
      return localStorage.getItem("rcw.files.autosave") === "1";
    } catch {
      return false;
    }
  });
  function toggleAutoSave() {
    setAutoSave((on) => {
      const next = !on;
      try {
        localStorage.setItem("rcw.files.autosave", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Right-click context menu + the folder-name / delete-confirm dialogs.
  const [menu, setMenu] = useState<{ x: number; y: number; target: MenuTarget } | null>(null);
  // The new-entry dialog — creates a file or folder inside `parent`.
  const [creating, setCreating] = useState<{ parent: string; kind: "file" | "folder" } | null>(null);
  const [entryName, setEntryName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; name: string; isDir: boolean } | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const loadDir = useCallback(
    async (dir: string) => {
      setLoadingDirs((s) => new Set(s).add(dir));
      try {
        const res = await window.cowork.listFiles({ cwd, machine, dir });
        if (res.ok) {
          setTree((t) => ({ ...t, [dir]: res.entries }));
          setTreeError(null);
        } else {
          setTreeError(res.error);
        }
      } catch (e) {
        setTreeError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingDirs((s) => {
          const n = new Set(s);
          n.delete(dir);
          return n;
        });
      }
    },
    [cwd, machine]
  );

  // Reset + load the root whenever the session/host changes.
  useEffect(() => {
    setTree({});
    setExpanded(new Set([cwd]));
    setOpenPath(null);
    setRead(null);
    setDrafts({});
    setTreeError(null);
    loadDir(cwd);
  }, [cwd, machine, loadDir]);

  function toggleDir(dir: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(dir)) n.delete(dir);
      else {
        n.add(dir);
        if (!tree[dir]) loadDir(dir);
      }
      return n;
    });
  }

  async function openFile(path: string) {
    setOpenPath(path);
    setReading(true);
    setSaveState({ kind: "idle" });
    setMdMode(isMarkdown(baseName(path)) ? "preview" : "edit");
    try {
      const res = await window.cowork.readFile({ cwd, machine, file: path });
      setRead(res);
      if (res.ok && res.encoding === "text") setOriginal(res.content);
      else setOriginal("");
    } catch (e) {
      setRead({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setReading(false);
    }
  }

  const value = openPath != null && openPath in drafts ? drafts[openPath] : original;
  const dirty = openPath != null && openPath in drafts && drafts[openPath] !== original;

  function onEdit(next: string | undefined) {
    if (openPath == null) return;
    setDrafts((d) => ({ ...d, [openPath]: next ?? "" }));
  }

  const save = useCallback(async () => {
    if (openPath == null) return;
    const content = openPath in drafts ? drafts[openPath] : original;
    setSaveState({ kind: "saving" });
    try {
      const res = await window.cowork.writeFile({ cwd, machine, file: openPath, content });
      if (res.ok) {
        setOriginal(content);
        setDrafts((d) => {
          const { [openPath]: _drop, ...rest } = d;
          return rest;
        });
        setSaveState({ kind: "ok", text: "✓ saved" });
      } else {
        setSaveState({ kind: "err", text: res.error ?? "save failed" });
      }
    } catch (e) {
      setSaveState({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    }
  }, [openPath, drafts, original, cwd, machine]);

  // ⌘S / Ctrl+S saves the open file.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        if (openPath && read?.ok && read.encoding === "text") {
          e.preventDefault();
          save();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPath, read, save]);

  // Auto-save: debounce a write ~700ms after the last edit while enabled. Each
  // keystroke re-runs this effect, clearing the prior timer (so we save once the
  // user pauses, not on every keypress).
  useEffect(() => {
    if (!autoSave || openPath == null) return;
    const isDirty = openPath in drafts && drafts[openPath] !== original;
    if (!isDirty || !(read?.ok && read.encoding === "text")) return;
    const t = setTimeout(() => save(), 700);
    return () => clearTimeout(t);
  }, [autoSave, drafts, openPath, original, read, save]);

  // Dismiss the context menu on any outside click / scroll / Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  /** Path relative to the project root, for "copy relative path". */
  function relPath(p: string): string {
    const root = cwd.replace(/\/+$/, "");
    if (p === root) return ".";
    return p.startsWith(root + "/") ? p.slice(root.length + 1) : p;
  }

  function openMenu(e: React.MouseEvent, target: MenuTarget) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, target });
  }

  async function copyRel(p: string) {
    setMenu(null);
    const rel = relPath(p);
    // Renderer-side copy first (no IPC / main restart needed); fall back to the
    // native clipboard over IPC if execCommand is unavailable.
    let ok = copyToClipboard(rel);
    if (!ok) {
      try {
        const r = await window.cowork.copyText(rel);
        ok = !!r?.ok;
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setToast(`Copied ${rel}`);
      setTimeout(() => setToast(null), 1800);
    } else {
      setOpError("couldn't copy to clipboard");
    }
  }

  function beginCreate(parent: string, kind: "file" | "folder") {
    setMenu(null);
    setOpError(null);
    setEntryName("");
    setCreating({ parent, kind });
  }

  async function submitCreate() {
    if (!creating) return;
    const { parent, kind } = creating;
    const res =
      kind === "folder"
        ? await window.cowork.makeDir({ cwd, machine, parent, name: entryName })
        : await window.cowork.createFile({ cwd, machine, parent, name: entryName });
    if (res.ok) {
      setCreating(null);
      setExpanded((s) => new Set(s).add(parent));
      await loadDir(parent);
      // Jump straight into a freshly created file.
      if (kind === "file" && res.path) openFile(res.path);
    } else {
      setOpError(res.error ?? `could not create ${kind}`);
    }
  }

  async function uploadInto(destDir: string) {
    setMenu(null);
    setOpError(null);
    const res = await window.cowork.uploadFiles({ cwd, machine, destDir });
    if (res.ok && res.uploaded > 0) {
      setExpanded((s) => new Set(s).add(destDir));
      await loadDir(destDir);
      setToast(`Uploaded ${res.uploaded} file${res.uploaded > 1 ? "s" : ""}`);
      setTimeout(() => setToast(null), 1800);
    } else if (!res.ok) {
      setOpError(res.error ?? "upload failed");
      setTimeout(() => setOpError(null), 2600);
    }
  }

  async function confirmDelete() {
    const t = deleteTarget;
    if (!t) return;
    const res = await window.cowork.deletePath({ cwd, machine, path: t.path });
    if (res.ok) {
      setDeleteTarget(null);
      if (openPath === t.path || (t.isDir && openPath?.startsWith(t.path + "/"))) {
        setOpenPath(null);
        setRead(null);
      }
      const parent = t.path.slice(0, t.path.lastIndexOf("/")) || cwd;
      await loadDir(parent);
    } else {
      setOpError(res.error ?? "delete failed");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ConnectionBar sessionId={sessionId} machine={machine} onHostChange={() => loadDir(cwd)} />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* File tree */}
        <div
          className="no-scrollbar"
          onContextMenu={(e) => openMenu(e, { kind: "root", path: cwd, parent: cwd })}
          style={{
            width: 256,
            flexShrink: 0,
            overflowY: "auto",
            borderRight: "1px solid var(--border)",
            padding: "10px 6px 16px",
          }}
        >
          {/* Root actions */}
          <div style={{ display: "flex", gap: 4, padding: "0 6px 8px" }}>
            <button onClick={() => beginCreate(cwd, "file")} title="New file in project root" style={treeActionBtn}>
              ＋ File
            </button>
            <button onClick={() => beginCreate(cwd, "folder")} title="New folder in project root" style={treeActionBtn}>
              ＋ Folder
            </button>
            <button onClick={() => uploadInto(cwd)} title="Upload file(s) to project root" style={treeActionBtn}>
              ⤓ Upload
            </button>
          </div>
          {treeError && (
            <div className="mono" style={{ fontSize: 11, color: "#e0736a", padding: "6px 10px" }}>
              {treeError}
            </div>
          )}
          <Tree
            dir={cwd}
            depth={0}
            tree={tree}
            expanded={expanded}
            loadingDirs={loadingDirs}
            openPath={openPath}
            drafts={drafts}
            onToggleDir={toggleDir}
            onOpenFile={openFile}
            onContextMenu={openMenu}
          />
        </div>

        {/* Editor / preview */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          {openPath == null ? (
            <div
              className="faint"
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontStyle: "italic" }}
            >
              Select a file to view or edit
            </div>
          ) : (
            <>
              {/* File header bar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "8px 16px",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span
                  className="mono"
                  style={{ fontSize: 11.5, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}
                  title={openPath}
                >
                  {baseName(openPath)}
                  {dirty && <span style={{ color: "rgb(var(--accent))", marginLeft: 6 }}>●</span>}
                </span>
                {read?.ok && "size" in read && (
                  <span className="faint mono" style={{ fontSize: 10.5, flexShrink: 0 }}>{humanSize(read.size)}</span>
                )}
                <span style={{ flex: 1 }} />
                {/* Markdown edit/preview toggle */}
                {read?.ok && read.encoding === "text" && isMarkdown(baseName(openPath)) && (
                  <div style={{ display: "flex", border: "1px solid var(--border)", borderRadius: 999, padding: 2, gap: 2 }}>
                    {(["edit", "preview"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMdMode(m)}
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 10.5,
                          padding: "3px 11px",
                          borderRadius: 999,
                          border: 0,
                          cursor: "pointer",
                          background: mdMode === m ? "rgb(var(--primary) / 0.32)" : "transparent",
                          color: mdMode === m ? "#fff" : "var(--text-soft)",
                        }}
                      >
                        {m === "edit" ? "Edit" : "Preview"}
                      </button>
                    ))}
                  </div>
                )}
                {saveState.kind !== "idle" && (
                  <span
                    className="mono"
                    style={{ fontSize: 10.5, color: saveState.kind === "err" ? "#e0736a" : saveState.kind === "ok" ? "rgb(var(--accent))" : "var(--text-soft)" }}
                  >
                    {saveState.kind === "saving" ? "saving…" : saveState.text}
                  </span>
                )}
                {read?.ok && read.encoding === "text" && (
                  <button
                    onClick={toggleAutoSave}
                    title={autoSave ? "Auto-save on — saves ~0.7s after you stop typing" : "Enable auto-save"}
                    style={{
                      border: "1px solid var(--border)",
                      background: autoSave ? "rgb(var(--accent) / 0.18)" : "transparent",
                      color: autoSave ? "rgb(var(--accent))" : "var(--text-soft)",
                      borderRadius: 8,
                      padding: "4px 11px",
                      fontSize: 10.5,
                      fontFamily: "var(--font-mono)",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {autoSave ? "● Auto-save" : "○ Auto-save"}
                  </button>
                )}
                {read?.ok && read.encoding === "text" && !autoSave && (
                  <button
                    onClick={save}
                    disabled={!dirty}
                    title="Save (⌘S)"
                    style={{
                      border: "1px solid var(--border)",
                      background: dirty ? "rgb(var(--primary) / 0.22)" : "transparent",
                      color: dirty ? "#fff" : "var(--text-soft)",
                      borderRadius: 8,
                      padding: "4px 13px",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      cursor: dirty ? "pointer" : "default",
                      opacity: dirty ? 1 : 0.55,
                    }}
                  >
                    Save
                  </button>
                )}
              </div>

              {/* File body */}
              <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                {reading ? (
                  <Centered>Loading…</Centered>
                ) : !read ? null : !read.ok ? (
                  <Centered error>{read.error}</Centered>
                ) : read.encoding === "binary" ? (
                  <Centered>
                    Binary file · {humanSize(read.size)} — too large or not previewable
                  </Centered>
                ) : read.encoding === "base64" && read.mime.startsWith("image/") ? (
                  <div style={{ position: "absolute", inset: 0, overflow: "auto", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }} className="no-scrollbar">
                    <img
                      src={`data:${read.mime};base64,${read.content}`}
                      alt={baseName(openPath)}
                      style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", imageRendering: "auto" }}
                    />
                  </div>
                ) : read.encoding === "base64" && read.mime === "application/pdf" ? (
                  <iframe
                    title={baseName(openPath)}
                    src={`data:application/pdf;base64,${read.content}`}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0, background: "#fff" }}
                  />
                ) : read.encoding === "text" && isMarkdown(baseName(openPath)) && mdMode === "preview" ? (
                  <div className="no-scrollbar" style={{ position: "absolute", inset: 0, overflow: "auto", padding: "20px 28px" }}>
                    <Markdown>{value}</Markdown>
                  </div>
                ) : read.encoding === "text" ? (
                  <Editor
                    height="100%"
                    theme={RCW_MONACO_THEME}
                    language={languageForFile(baseName(openPath))}
                    path={openPath}
                    value={value}
                    onChange={onEdit}
                    options={{
                      fontSize: 12.5,
                      minimap: { enabled: true },
                      scrollBeyondLastLine: false,
                      wordWrap: "on",
                      automaticLayout: true,
                      tabSize: 2,
                      renderWhitespace: "selection",
                    }}
                  />
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Transient feedback toast (copy / upload / errors outside a modal) */}
      {(toast || (opError && creating == null && !deleteTarget)) && (
        <div
          className="glass-menu mono"
          style={{
            position: "fixed",
            bottom: 22,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 70,
            fontSize: 11.5,
            padding: "8px 16px",
            borderRadius: 999,
            border: "1px solid var(--border-strong)",
            color: toast ? "rgb(var(--accent))" : "#e0736a",
            boxShadow: "0 14px 40px -16px rgba(0,0,0,.7)",
          }}
        >
          {toast ?? opError}
        </div>
      )}

      {/* Right-click context menu */}
      {menu && (
        <div
          className="glass-menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: Math.min(menu.x, window.innerWidth - 190),
            top: Math.min(menu.y, window.innerHeight - 180),
            zIndex: 50,
            minWidth: 176,
            borderRadius: 10,
            border: "1px solid var(--border-strong)",
            padding: 5,
            boxShadow: "0 18px 50px -16px rgba(0,0,0,.7)",
          }}
        >
          {menu.target.kind !== "root" && (
            <MenuItem onClick={() => copyRel(menu.target.path)}>Copy relative path</MenuItem>
          )}
          <MenuItem onClick={() => beginCreate(menu.target.parent, "file")}>New file…</MenuItem>
          <MenuItem onClick={() => beginCreate(menu.target.parent, "folder")}>New folder…</MenuItem>
          <MenuItem onClick={() => uploadInto(menu.target.parent)}>Upload file…</MenuItem>
          {menu.target.kind !== "root" && (
            <>
              <div style={{ height: 1, background: "var(--border)", margin: "5px 6px" }} />
              <MenuItem
                danger
                onClick={() => {
                  const t = menu.target as Extract<MenuTarget, { kind: "file" | "dir" }>;
                  setMenu(null);
                  setOpError(null);
                  setDeleteTarget({ path: t.path, name: baseName(t.path), isDir: t.kind === "dir" });
                }}
              >
                Delete {menu.target.kind === "dir" ? "folder" : "file"}
              </MenuItem>
            </>
          )}
        </div>
      )}

      {/* New file / folder name dialog */}
      {creating != null && (
        <Modal onClose={() => setCreating(null)}>
          <div className="mono" style={{ fontSize: 11, color: "var(--text-soft)", marginBottom: 10 }}>
            New {creating.kind} in <span style={{ color: "var(--text)" }}>{relPath(creating.parent)}</span>
          </div>
          <input
            autoFocus
            className="reply-input"
            value={entryName}
            onChange={(e) => setEntryName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
              if (e.key === "Escape") setCreating(null);
            }}
            placeholder={creating.kind === "file" ? "file-name.ext" : "folder-name"}
            style={modalInput}
          />
          {opError && <div style={{ color: "#e0736a", fontSize: 11, marginTop: 8 }}>{opError}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button onClick={() => setCreating(null)} style={modalBtn}>Cancel</button>
            <button onClick={submitCreate} className="glass-btn--clay" style={{ ...modalBtn, color: "#fff" }} disabled={!entryName.trim()}>
              Create
            </button>
          </div>
        </Modal>
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <Modal onClose={() => setDeleteTarget(null)}>
          <div style={{ fontSize: 13, color: "var(--text)", marginBottom: 6 }}>
            Delete {deleteTarget.isDir ? "folder" : "file"}{" "}
            <span className="mono" style={{ color: "rgb(var(--accent))" }}>{deleteTarget.name}</span>?
          </div>
          <div className="faint" style={{ fontSize: 11.5, lineHeight: 1.5 }}>
            {deleteTarget.isDir ? "This removes the folder and everything inside it. " : ""}This can't be undone.
          </div>
          {opError && <div style={{ color: "#e0736a", fontSize: 11, marginTop: 8 }}>{opError}</div>}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button onClick={() => setDeleteTarget(null)} style={modalBtn}>Cancel</button>
            <button
              onClick={confirmDelete}
              style={{ ...modalBtn, background: "rgba(224,115,106,0.18)", color: "#e0736a", border: "1px solid rgba(224,115,106,0.4)" }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** A single context-menu row. */
function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <div
      onClick={onClick}
      className="mono glass-inset-hover"
      style={{
        fontSize: 11.5,
        padding: "7px 10px",
        borderRadius: 7,
        cursor: "pointer",
        color: danger ? "#e0736a" : "var(--text)",
      }}
    >
      {children}
    </div>
  );
}

/** Centered modal overlay used for folder-name input and delete confirmation. */
function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
    >
      <div
        className="glass-menu"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 320, borderRadius: 14, border: "1px solid var(--border-strong)", padding: "18px 18px 16px" }}
      >
        {children}
      </div>
    </div>
  );
}

const treeActionBtn: React.CSSProperties = {
  flex: 1,
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-soft)",
  borderRadius: 7,
  padding: "4px 6px",
  fontSize: 10.5,
  fontFamily: "var(--font-mono)",
  cursor: "pointer",
};

const modalInput: React.CSSProperties = {
  width: "100%",
  borderRadius: 10,
  border: "1px solid var(--border)",
  padding: "9px 12px",
  color: "var(--text)",
  caretColor: "rgb(var(--primary-soft))",
  fontSize: 13,
  background: "rgba(255,255,255,0.03)",
  outline: "none",
  fontFamily: "var(--font-mono)",
  boxSizing: "border-box",
};

const modalBtn: React.CSSProperties = {
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text-soft)",
  borderRadius: 8,
  padding: "6px 16px",
  fontSize: 12,
  cursor: "pointer",
};

function Centered({ children, error }: { children: React.ReactNode; error?: boolean }) {
  return (
    <div
      className={error ? "mono" : "faint"}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 24,
        fontSize: 12.5,
        fontStyle: error ? "normal" : "italic",
        color: error ? "#e0736a" : undefined,
      }}
    >
      {children}
    </div>
  );
}

interface TreeProps {
  dir: string;
  depth: number;
  tree: Record<string, DirEntry[]>;
  expanded: Set<string>;
  loadingDirs: Set<string>;
  openPath: string | null;
  drafts: Record<string, string>;
  onToggleDir: (dir: string) => void;
  onOpenFile: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, target: MenuTarget) => void;
}

function Tree(props: TreeProps) {
  const { dir, depth, tree, expanded, loadingDirs, openPath, drafts, onToggleDir, onOpenFile, onContextMenu } = props;
  const entries = tree[dir];
  if (!entries) {
    return loadingDirs.has(dir) ? (
      <Row depth={depth} muted>…</Row>
    ) : null;
  }
  return (
    <>
      {entries.map((e) =>
        e.kind === "dir" ? (
          <div key={e.path}>
            <Row
              depth={depth}
              onClick={() => onToggleDir(e.path)}
              onContextMenu={(ev) => onContextMenu(ev, { kind: "dir", path: e.path, parent: e.path })}
            >
              <span style={{ width: 12, display: "inline-block", opacity: 0.6 }}>
                {expanded.has(e.path) ? "▾" : "▸"}
              </span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
            </Row>
            {expanded.has(e.path) && <Tree {...props} dir={e.path} depth={depth + 1} />}
          </div>
        ) : (
          <Row
            key={e.path}
            depth={depth}
            active={openPath === e.path}
            onClick={() => onOpenFile(e.path)}
            onContextMenu={(ev) =>
              onContextMenu(ev, { kind: "file", path: e.path, parent: e.path.slice(0, e.path.lastIndexOf("/")) })
            }
          >
            <span style={{ width: 12, display: "inline-block" }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.name}</span>
            {e.path in drafts && <span style={{ color: "rgb(var(--accent))", marginLeft: "auto", flexShrink: 0 }}>●</span>}
          </Row>
        )
      )}
    </>
  );
}

function Row({
  depth,
  children,
  onClick,
  onContextMenu,
  active,
  muted,
}: {
  depth: number;
  children: React.ReactNode;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  active?: boolean;
  muted?: boolean;
}) {
  return (
    <div
      onClick={onClick}
      onContextMenu={onContextMenu}
      className="mono"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11.5,
        lineHeight: 1.2,
        padding: "3px 8px",
        paddingLeft: 8 + depth * 12,
        borderRadius: 7,
        cursor: onClick ? "pointer" : "default",
        color: active ? "var(--text)" : muted ? "var(--text-soft)" : "var(--text-soft)",
        background: active ? "rgb(var(--primary) / 0.18)" : "transparent",
        whiteSpace: "nowrap",
        overflow: "hidden",
      }}
      onMouseEnter={(ev) => {
        if (!active && onClick) (ev.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)";
      }}
      onMouseLeave={(ev) => {
        if (!active) (ev.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
    >
      {children}
    </div>
  );
}
