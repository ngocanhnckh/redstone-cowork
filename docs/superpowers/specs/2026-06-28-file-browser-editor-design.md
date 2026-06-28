# Files tab — file browser + code editor (design)

**Date:** 2026-06-28
**Status:** implemented

## Goal

A **Files** workspace tab (⌃5) in the cockpit that browses the session's project
tree and opens any file: a VS Code-grade editor for text/code, inline preview for
images and PDFs, and edit-or-preview for Markdown.

## Decisions

- **Editor engine: Monaco** (the editor that powers VS Code) via
  `@monaco-editor/react` + `monaco-editor`, configured to load entirely from local
  `node_modules` (no CDN — Electron may be offline) with language workers wired
  through Vite `?worker` imports (`monaco-setup.ts`).
- **Transport: the existing split-brain.** Local sessions (`isLocalMachine`) use
  `fs` directly; remote sessions go over the multiplexed SSH connection
  (`sshMuxOpts`), exactly like `workspace.ts`.
- **Explicit save only** (⌘S / Ctrl+S or the Save button) — no autosave. Unsaved
  edits are kept per-file in a drafts map so switching files never loses work; a
  dirty dot marks both the header and the tree row.

## Backend (`apps/desktop/src/main/files.ts`)

- `listDir` — lazy, per-directory. Local: `fs.readdir` + `stat`. Remote: a single
  shell loop emitting `type\tsize\tname` per entry. Dirs first, then files,
  case-insensitive alphabetical.
- `readFileAt` — returns one of: `text` (utf8, capped at 2 MB, binary-sniffed),
  `base64` (images/pdf, capped at 25 MB), or `binary` (too large / not
  previewable).
- `writeFileAt` — local `fs.writeFile`; remote `cat > file` from stdin.
- IPC: `files:list` / `files:read` / `files:write`; preload `listFiles` /
  `readFile` / `writeFile`; handlers never throw across the boundary.

## UI (`FilesPanel.tsx`)

- Left: lazy file tree (click a dir to expand, fetched on demand). Right: a header
  (name · size · markdown Edit/Preview toggle · save state · Save) over the body.
- Body by type: Monaco editor for text/code; `<img>` for images; `<iframe>` data
  URL for PDFs (Chromium's built-in viewer); the existing `Markdown` component for
  Markdown preview; a "Binary file" notice otherwise.

## Wiring

`FocusStage` registers the tab and renders `FilesPanel`; `Cockpit` adds it to the
Ctrl+Tab cycle and the ⌃5 shortcut; `store` widens the `activeTab` union.
