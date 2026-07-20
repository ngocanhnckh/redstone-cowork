import { useEffect, useState, useCallback, useRef, useDeferredValue } from "react";
import FileSearch from "./FileSearch";
import { createPortal } from "react-dom";
import Editor from "@monaco-editor/react";
import OfficeViewer, { isOfficeFile } from "./OfficeViewer";
import ConnectionBar from "./ConnectionBar";
import Markdown from "./Markdown";
import { ensureMonaco, languageForFile, RCW_MONACO_THEME } from "./monaco-setup";

interface Props {
  sessionId: string;
  cwd: string;
  machine: string;
}

ensureMonaco();

/**
 * Render `children` into `document.body` so `position: fixed` overlays escape the
 * panel's stacking/containing block. In HUD Windows mode the panel wrapper has a
 * `backdrop-filter` (glass), which per spec makes it the containing block for
 * fixed descendants — without this portal the context menu / toast / modals would
 * be positioned relative to the window corner and fly off-screen.
 */
function Portal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body);
}

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

/* ── Directory listing cache ──────────────────────────────────────────────────
 * Lives at module scope, NOT in component state or a ref: the panel is mounted
 * conditionally by the HUD / FocusStage, so it unmounts on every tab switch —
 * anything component-local would be thrown away and each re-expand would spin
 * again. Keyed by `${machine} ${dir}` so two hosts never share a listing.
 */
const dirCache = new Map<string, DirEntry[]>();
/** In-flight listFiles calls, so a prefetch and a user expand share one request. */
const dirInflight = new Map<string, Promise<DirResult>>();

type DirResult = { ok: true; entries: DirEntry[] } | { ok: false; error: string };

const dirKey = (machine: string, dir: string): string => `${machine} ${dir}`;

/** Identical listings? Compared by name+kind+size so an unchanged dir re-renders nothing. */
function sameEntries(a: DirEntry[], b: DirEntry[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].name !== b[i].name || a[i].kind !== b[i].kind || a[i].size !== b[i].size) return false;
  }
  return true;
}

/** List a directory, deduping concurrent callers and populating the cache. */
function fetchDir(cwd: string, machine: string, dir: string): Promise<DirResult> {
  const key = dirKey(machine, dir);
  const running = dirInflight.get(key);
  if (running) return running;
  const p = window.cowork
    .listFiles({ cwd, machine, dir })
    .then((res): DirResult => {
      if (res.ok) dirCache.set(key, res.entries);
      return res;
    })
    .catch((e): DirResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) }))
    .finally(() => dirInflight.delete(key));
  dirInflight.set(key, p);
  return p;
}

/** Drop a dir (and, for a deleted folder, everything beneath it) from the cache. */
function invalidateDir(machine: string, dir: string, subtree = false): void {
  const key = dirKey(machine, dir);
  dirCache.delete(key);
  dirInflight.delete(key);
  if (!subtree) return;
  for (const k of [...dirCache.keys()]) if (k.startsWith(key + "/")) dirCache.delete(k);
}

/* Prefetch one level ahead: after a dir renders we warm its subdirectories so the
 * next expand is instant. Capped concurrency — a folder with 200 subdirs would
 * otherwise fire 200 SSH execs at once and starve the listing the user is waiting on. */
const PREFETCH_MAX = 4;
let prefetchActive = 0;
const prefetchQueue: Array<() => void> = [];

function pumpPrefetch(): void {
  while (prefetchActive < PREFETCH_MAX && prefetchQueue.length) {
    const job = prefetchQueue.shift()!;
    prefetchActive++;
    job();
  }
}

/** Queue background listings for `entries`' subdirectories (skips ones already known). */
function prefetchChildren(cwd: string, machine: string, entries: DirEntry[]): void {
  for (const e of entries) {
    if (e.kind !== "dir") continue;
    const key = dirKey(machine, e.path);
    if (dirCache.has(key) || dirInflight.has(key)) continue;
    const dir = e.path;
    prefetchQueue.push(() => {
      // Re-check: the user may have expanded (and thus cached) this dir while queued.
      const done = () => {
        prefetchActive--;
        pumpPrefetch();
      };
      if (dirCache.has(dirKey(machine, dir))) return done();
      fetchDir(cwd, machine, dir).then(done, done);
    });
  }
  pumpPrefetch();
}

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
  const [searchOpen, setSearchOpen] = useState(false);
  // Monaco editor instance (for in-file find + reveal-on-open from search results).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  const pendingReveal = useRef<number | null>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  // Dirs the user chose to render in full (past the per-dir cap). Big folders like
  // node_modules would otherwise emit thousands of DOM rows and freeze the app.
  const [showAll, setShowAll] = useState<Set<string>>(new Set());
  const revealAllInDir = useCallback((dir: string) => setShowAll((s) => new Set(s).add(dir)), []);

  // The scope a listing belongs to — an in-flight load from the previous session /
  // host must not paint into the tree after the user switched.
  const scopeRef = useRef(`${machine} ${cwd}`);
  useEffect(() => {
    scopeRef.current = `${machine} ${cwd}`;
  }, [cwd, machine]);

  /**
   * Load a directory into the tree. Cached listings paint immediately (no spinner)
   * and are then revalidated in the background — the state is only replaced if the
   * listing actually changed, so a re-expand of an unchanged folder is a no-op.
   */
  const loadDir = useCallback(
    async (dir: string) => {
      const scope = `${machine} ${cwd}`;
      const cached = dirCache.get(dirKey(machine, dir));
      if (cached) {
        setTree((t) => (t[dir] && sameEntries(t[dir], cached) ? t : { ...t, [dir]: cached }));
      } else {
        // Only spin when we have nothing to show for this dir.
        setLoadingDirs((s) => new Set(s).add(dir));
      }
      const res = await fetchDir(cwd, machine, dir);
      if (scopeRef.current === scope) {
        if (res.ok) {
          setTree((t) => (t[dir] && sameEntries(t[dir], res.entries) ? t : { ...t, [dir]: res.entries }));
          setTreeError(null);
          // Warm one level down so the next expand is instant.
          prefetchChildren(cwd, machine, res.entries);
        } else {
          setTreeError(res.error);
        }
      }
      if (!cached) {
        setLoadingDirs((s) => {
          if (!s.has(dir)) return s;
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
    // Warm the SSH master for a remote host now, so the first file the user opens
    // doesn't pay the (relay-amplified) connection handshake and appear to freeze.
    window.cowork.warmHost(machine).catch(() => {/* best-effort */});
    loadDir(cwd);
  }, [cwd, machine, loadDir]);

  function toggleDir(dir: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(dir)) n.delete(dir);
      else {
        // Always call loadDir — it paints the cached listing synchronously (if any)
        // and revalidates in the background, so this is free when nothing changed.
        n.add(dir);
        loadDir(dir);
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
  // Rendering markdown is synchronous and O(size); a deferred copy lets React keep
  // scrolling/input responsive while the (heavy) preview renders in the background,
  // and a hard cap falls back to the source view so a huge doc can never freeze it.
  const deferredValue = useDeferredValue(value);
  const MD_PREVIEW_MAX = 300_000; // ~300 KB of markdown

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

  // Download any file to a local path chosen via the OS Save dialog. Works for any
  // file (text or binary), no size cap — streams from the host. Used by the toolbar
  // button (open file) and the tree's right-click menu (any file).
  const [downloading, setDownloading] = useState(false);
  const downloadPath = useCallback(async (path: string) => {
    if (!path || downloading) return;
    setDownloading(true);
    try {
      const res = await window.cowork.downloadFile({ cwd, machine, file: path });
      if (res.ok) setToast(`Downloaded ${baseName(path)}`);
      else if (!res.canceled) setToast(`Download failed: ${res.error ?? "error"}`);
    } catch (e) {
      setToast(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDownloading(false);
    }
  }, [cwd, machine, downloading]);

  // Auto-dismiss the toast so it never sticks around (some callers set it without
  // their own timer — e.g. download / replace). Cleared whenever the text changes.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

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

  // ⌘F = find in the open file (Monaco); ⌘⇧F = find/replace across all files.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || (e.key !== "f" && e.key !== "F")) return;
      if (e.shiftKey) {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      // In-file find: if the editor isn't already focused (where Monaco handles ⌘F
      // itself), focus it and open its find widget.
      const ed = editorRef.current;
      if (ed && !ed.hasTextFocus?.()) {
        e.preventDefault();
        ed.focus();
        ed.getAction?.("actions.find")?.run();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // After a search result opens a file, reveal the matched line once its content
  // has loaded (Monaco needs a tick to swap models).
  useEffect(() => {
    if (pendingReveal.current == null) return;
    if (!(read?.ok && read.encoding === "text") || !editorRef.current) return;
    const line = pendingReveal.current;
    pendingReveal.current = null;
    const ed = editorRef.current;
    const t = setTimeout(() => {
      try { ed.revealLineInCenter(line); ed.setPosition({ lineNumber: line, column: 1 }); ed.focus(); } catch { /* editor gone */ }
    }, 60);
    return () => clearTimeout(t);
  }, [read, openPath]);

  const openFileAtLine = useCallback((path: string, line: number) => {
    pendingReveal.current = line;
    openFile(path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reload the open file from disk after a cross-file replace touched it.
  const onReplaced = useCallback((paths: string[]) => {
    if (openPath && paths.includes(openPath)) {
      setDrafts((d) => { const next = { ...d }; delete next[openPath]; return next; });
      openFile(openPath);
    }
    if (paths.length) setToast(`Replaced in ${paths.length} file${paths.length === 1 ? "" : "s"}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openPath]);

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

  // Dismiss the context menu on an outside click, Escape, or scrolling the file tree.
  // The scroll listener is scoped to the tree container (NOT a global capture) — the
  // app has constantly-scrolling panels (chat stream, terminal, telemetry) that would
  // otherwise slam the menu shut a moment after it opened.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    const tree = treeScrollRef.current;
    window.addEventListener("click", close);
    tree?.addEventListener("scroll", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", close);
      tree?.removeEventListener("scroll", close);
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

  /** Copy arbitrary text with the same renderer-first / IPC-fallback strategy. */
  async function copyText(text: string) {
    setMenu(null);
    // Renderer-side copy first (no IPC / main restart needed); fall back to the
    // native clipboard over IPC if execCommand is unavailable.
    let ok = copyToClipboard(text);
    if (!ok) {
      try {
        const r = await window.cowork.copyText(text);
        ok = !!r?.ok;
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setToast(`Copied ${text}`);
      setTimeout(() => setToast(null), 1800);
    } else {
      setOpError("couldn't copy to clipboard");
    }
  }

  const copyRel = (p: string) => copyText(relPath(p));
  const copyAbs = (p: string) => copyText(p);

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
      invalidateDir(machine, parent);
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
      invalidateDir(machine, destDir);
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
      // A deleted folder takes its whole cached subtree with it.
      if (t.isDir) invalidateDir(machine, t.path, true);
      invalidateDir(machine, parent);
      await loadDir(parent);
    } else {
      setOpError(res.error ?? "delete failed");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* A host change points the same machine id at different files — drop the cache. */}
      <ConnectionBar
        sessionId={sessionId}
        machine={machine}
        onHostChange={() => {
          invalidateDir(machine, cwd, true);
          loadDir(cwd);
        }}
      />
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* File tree — or project-wide search when toggled (⌘⇧F) */}
        <div
          ref={treeScrollRef}
          className="no-scrollbar"
          onContextMenu={searchOpen ? undefined : (e) => openMenu(e, { kind: "root", path: cwd, parent: cwd })}
          style={{
            width: 256,
            flexShrink: 0,
            overflowY: searchOpen ? "hidden" : "auto",
            borderRight: "1px solid var(--border)",
            padding: searchOpen ? 0 : "10px 6px 16px",
          }}
        >
          {searchOpen ? (
            <FileSearch
              cwd={cwd}
              machine={machine}
              autoFocus
              onOpen={openFileAtLine}
              onReplaced={onReplaced}
              onClose={() => setSearchOpen(false)}
            />
          ) : (
            <>
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
                <button onClick={() => setSearchOpen(true)} title="Find in all files (⌘⇧F)" style={treeActionBtn}>
                  ⌕ Search
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
                showAll={showAll}
                onShowAll={revealAllInDir}
              />
            </>
          )}
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
                {openPath != null && (
                  <button
                    onClick={() => downloadPath(openPath)}
                    disabled={downloading}
                    title="Download this file to your computer"
                    style={{
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--text-soft)",
                      borderRadius: 8,
                      padding: "4px 11px",
                      fontSize: 10.5,
                      fontFamily: "var(--font-mono)",
                      cursor: downloading ? "default" : "pointer",
                      whiteSpace: "nowrap",
                      opacity: downloading ? 0.6 : 1,
                      flexShrink: 0,
                    }}
                  >
                    {downloading ? "⤓ …" : "⤓ Download"}
                  </button>
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
                ) : isOfficeFile(baseName(openPath)) && read.encoding === "base64" ? (
                  <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
                    <OfficeViewer cwd={cwd} machine={machine} path={openPath} base64={read.content} name={baseName(openPath)} />
                  </div>
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
                    {value.length > MD_PREVIEW_MAX ? (
                      <div className="faint" style={{ fontSize: 12.5, fontStyle: "italic" }}>
                        Large file ({humanSize(read.size)}) — rich preview is disabled to keep scrolling smooth. Switch to the source view (the ⟨⟩ toggle) to read it.
                      </div>
                    ) : (
                      <Markdown>{deferredValue}</Markdown>
                    )}
                  </div>
                ) : read.encoding === "text" ? (
                  <Editor
                    height="100%"
                    theme={RCW_MONACO_THEME}
                    language={languageForFile(baseName(openPath))}
                    path={openPath}
                    value={value}
                    onChange={onEdit}
                    onMount={(ed) => { editorRef.current = ed; }}
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
        <Portal>
        <div
          className="glass-menu mono"
          style={{
            position: "fixed",
            bottom: 22,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 2147483000,
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
        </Portal>
      )}

      {/* Right-click context menu */}
      {menu && (
        <Portal>
        <div
          className="glass-menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: Math.min(menu.x, window.innerWidth - 190),
            top: Math.min(menu.y, window.innerHeight - 200),
            zIndex: 2147483000,
            minWidth: 176,
            borderRadius: 10,
            border: "1px solid var(--border-strong)",
            padding: 5,
            boxShadow: "0 18px 50px -16px rgba(0,0,0,.7)",
          }}
        >
          {menu.target.kind !== "root" && (
            <>
              <MenuItem onClick={() => copyAbs(menu.target.path)}>Copy path</MenuItem>
              <MenuItem onClick={() => copyRel(menu.target.path)}>Copy relative path</MenuItem>
            </>
          )}
          {menu.target.kind === "file" && (
            <MenuItem
              onClick={() => {
                const t = menu.target as Extract<MenuTarget, { kind: "file" | "dir" }>;
                setMenu(null);
                downloadPath(t.path);
              }}
            >
              Download…
            </MenuItem>
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
        </Portal>
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
    <Portal>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 2147483000, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <div
          className="glass-menu"
          onClick={(e) => e.stopPropagation()}
          style={{ width: 320, borderRadius: 14, border: "1px solid var(--border-strong)", padding: "18px 18px 16px" }}
        >
          {children}
        </div>
      </div>
    </Portal>
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
  showAll: Set<string>;
  onShowAll: (dir: string) => void;
}

// Cap rows rendered per directory. A folder with thousands of entries (node_modules,
// build output) would otherwise mount thousands of DOM nodes at once — freezing the
// app on expand and making the whole tree scroll laggy. The rest render on demand.
const DIR_ROW_CAP = 300;

function Tree(props: TreeProps) {
  const { dir, depth, tree, expanded, loadingDirs, openPath, drafts, onToggleDir, onOpenFile, onContextMenu, showAll, onShowAll } = props;
  const entries = tree[dir];
  if (!entries) {
    return loadingDirs.has(dir) ? (
      <Row depth={depth} muted>…</Row>
    ) : null;
  }
  const capped = !showAll.has(dir) && entries.length > DIR_ROW_CAP;
  const shown = capped ? entries.slice(0, DIR_ROW_CAP) : entries;
  return (
    <>
      {shown.map((e) =>
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
      {capped && (
        <Row depth={depth} onClick={() => onShowAll(dir)}>
          <span style={{ width: 12, display: "inline-block" }} />
          <span style={{ color: "var(--text-faint)", fontStyle: "italic" }}>
            … {entries.length - DIR_ROW_CAP} more — show all
          </span>
        </Row>
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
