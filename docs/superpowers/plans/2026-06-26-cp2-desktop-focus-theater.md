# CP2 — Desktop App: Focus Theater (first slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** A runnable Electron desktop cockpit ("Focus Theater") that logs into a Cowork server, renders the live **waiting queue**, shows the focused session's latest answer + decision, lets you **answer** it (multiple-choice or custom reply), and **auto-advances** to the next waiting session — in the approved liquid-glass Warm Ink look.

**Architecture:** New `apps/desktop` built with **electron-vite** (Vite + React 19 + TS). The **main process** owns the authenticated server connection: it stores the server URL + `INSTANCE_TOKEN` encrypted (`safeStorage`), makes all API calls, and holds the **SSE `/stream`** subscription (renderer can't — `EventSource` can't send the Bearer header), forwarding events + state to the renderer over a typed `contextBridge` (`window.cowork`). The **renderer** is a pure React view of that state. macOS/Windows desktop; Electron runs locally on the Mac (this is NOT Docker — allowed).

**Tech Stack:** electron-vite, electron, React 19, TypeScript, Tailwind CSS v4 (`@tailwindcss/vite`), the liquid-glass `globals.css` (from the user's skill), `motion` (motion/react), `zustand` (renderer store), Vitest + @testing-library/react (renderer logic tests).

## Global Constraints

- pnpm@10.12.1 workspace (globs `apps/*`); Node >=22. New package name: **`@rcw/desktop`**, private.
- Server API (all Bearer-guarded by `INSTANCE_TOKEN`): `GET /sessions`, `GET /sessions/queue`, `GET /decisions` (pending), `POST /decisions/:id/resolve` body `{choice?:string|null, answers?:Record<string,string|string[]>|null, custom?:string|null}`, `POST /sessions/:id/snooze` `{minutes}`, `POST /sessions/:id/pin` `{pinned}`, `GET /stream` (SSE: `{type:"decision.created"|"decision.resolved"|"session.updated", payload}`).
- Reuse shared types from `@rcw/shared` (`SessionView` shape: `AgentSession & {status, pendingDecisions, waitingSince}`; `Decision`).
- UI must use the liquid-glass system (Warm Ink: clay `229 77 46` = the action, amber `226 169 91` = waiting-on-you). Visual reference: `docs/superpowers/specs/assets/cockpit-focus-theater.html`.
- Conventional commits; end every commit body with: `Claude-Session: https://claude.ai/code/session_016i5ks36DdRD5qK7LiRcF4R`.
- Token is stored ONLY in the main process (encrypted). The renderer never sees the raw token; it calls `window.cowork.*`.

---

### Task 1: Scaffold `apps/desktop` (electron-vite + React + Tailwind v4 + liquid-glass)

**Files (create):** `apps/desktop/package.json`, `apps/desktop/electron.vite.config.ts`, `apps/desktop/tsconfig.json`, `apps/desktop/src/main/index.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/renderer/index.html`, `apps/desktop/src/renderer/src/main.tsx`, `apps/desktop/src/renderer/src/App.tsx`, `apps/desktop/src/renderer/src/styles/globals.css` (copy from `/tmp/lg-skill/assets/globals.css` if present, else from `docs/superpowers/specs/assets/cockpit-focus-theater.html`'s inline tokens), `apps/desktop/.gitignore`.

**Deliverable:** `pnpm --filter @rcw/desktop build` succeeds; `pnpm --filter @rcw/desktop dev` opens a frameless dark window showing the atmosphere blobs + the "Redstone Cowork" wordmark. (GUI launch verified by the user; CI verifies build + typecheck.)

- [ ] **Step 1: Create `apps/desktop/package.json`**

```json
{
  "name": "@rcw/desktop",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "start": "electron-vite preview"
  },
  "dependencies": {
    "@rcw/shared": "workspace:*",
    "zustand": "^5.0.2"
  },
  "devDependencies": {
    "electron": "^33.2.0",
    "electron-vite": "^2.3.0",
    "vite": "^6.0.0",
    "@vitejs/plugin-react": "^4.3.4",
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "motion": "^11.15.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0",
    "@testing-library/react": "^16.1.0",
    "jsdom": "^25.0.0"
  }
}
```

- [ ] **Step 2: `electron.vite.config.ts`**

```ts
import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: { build: { rollupOptions: { input: { index: resolve(__dirname, "src/main/index.ts") } } } },
  preload: { build: { rollupOptions: { input: { index: resolve(__dirname, "src/preload/index.ts") } } } },
  renderer: {
    root: "src/renderer",
    plugins: [react(), tailwindcss()],
    build: { rollupOptions: { input: { index: resolve(__dirname, "src/renderer/index.html") } } },
  },
});
```

- [ ] **Step 3: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"], "jsx": "react-jsx",
    "strict": true, "skipLibCheck": true, "esModuleInterop": true,
    "noEmit": true, "types": ["node", "vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Main process `src/main/index.ts` (minimal window for now; expanded in later tasks)**

```ts
import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirnameLocal = dirname(fileURLToPath(import.meta.url));

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, show: false,
    titleBarStyle: "hiddenInset", backgroundColor: "#15110D",
    webPreferences: { preload: join(__dirnameLocal, "../preload/index.js"), sandbox: false },
  });
  win.on("ready-to-show", () => win.show());
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(__dirnameLocal, "../renderer/index.html"));
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
```

- [ ] **Step 5: Preload `src/preload/index.ts` (stub bridge; filled in Task 3)**

```ts
import { contextBridge } from "electron";
contextBridge.exposeInMainWorld("cowork", { ping: () => "pong" });
```

- [ ] **Step 6: Renderer entry + first screen**

`src/renderer/index.html`:
```html
<!doctype html>
<html><head><meta charset="utf-8" /><title>Redstone Cowork</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
```

`src/renderer/src/main.tsx`:
```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/globals.css";
createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
```

`src/renderer/src/App.tsx` — a body with `data-app`, the atmosphere blobs, and the wordmark (use the glass classes from globals.css):
```tsx
export default function App() {
  return (
    <div data-app className="grain" style={{ minHeight: "100vh" }}>
      <div className="atmosphere"><div className="blob blob--a" /><div className="blob blob--b" /><div className="blob blob--c" /></div>
      <main style={{ position: "relative", zIndex: 2, padding: 40 }}>
        <span className="kicker">Redstone Cowork · Desktop</span>
        <h1 className="display" style={{ fontSize: 48 }}>Focus Theater</h1>
      </main>
    </div>
  );
}
```

`src/renderer/src/styles/globals.css`: `@import "tailwindcss";` then paste the liquid-glass utilities + tokens + atmosphere keyframes from the user's skill (`/tmp/lg-skill/assets/globals.css`), set the three Warm Ink triplets and wire fonts. (If `/tmp/lg-skill` is gone, extract the `<style>` block from `docs/superpowers/specs/assets/cockpit-focus-theater.html`.)

- [ ] **Step 7: `.gitignore`** — `out/` and `node_modules/`.

- [ ] **Step 8: Install + build + typecheck**

Run: `pnpm install && pnpm --filter @rcw/desktop typecheck && pnpm --filter @rcw/desktop build`
Expected: install resolves; typecheck exit 0; `electron-vite build` produces `out/main`, `out/preload`, `out/renderer`. (Do NOT block on launching the GUI in CI.)

- [ ] **Step 9: Commit**

```bash
git add apps/desktop pnpm-lock.yaml
git commit -m "feat(desktop): scaffold Electron + React + liquid-glass Focus Theater shell

Claude-Session: https://claude.ai/code/session_016i5ks36DdRD5qK7LiRcF4R"
```

---

### Task 2: Secure config + login (main store, renderer login screen)

**Files:**
- Create: `apps/desktop/src/main/config.ts` (token store via `safeStorage` + JSON in `app.getPath("userData")`)
- Modify: `apps/desktop/src/main/index.ts` (register `ipcMain.handle` for config get/set/clear)
- Modify: `apps/desktop/src/preload/index.ts` (expose `getConfig/saveConfig/clearConfig`)
- Create: `apps/desktop/src/renderer/src/Login.tsx` + wire into `App.tsx`
- Test: `apps/desktop/src/main/config.test.ts`

**Interfaces:**
- Produces (main): `loadConfig(): {serverUrl: string; hasToken: boolean} | null`, `saveConfig(serverUrl: string, token: string): void`, `getToken(): string | null`, `clearConfig(): void`. The token is encrypted with `safeStorage.encryptString` and never returned to the renderer.
- Produces (preload `window.cowork`): `getConfig(): Promise<{serverUrl:string; hasToken:boolean}|null>`, `saveConfig(serverUrl, token): Promise<{ok:boolean}>`, `clearConfig(): Promise<void>`.

- [ ] **Step 1: Failing test `config.test.ts`** — unit-test the JSON serialization/shape of `config.ts` with `safeStorage` mocked (encrypt = identity passthrough) and a temp dir, asserting `saveConfig` then `loadConfig` reports `{serverUrl, hasToken:true}` and `getToken` round-trips, and `clearConfig` wipes it. (Mock `electron`'s `app.getPath` to a tmp dir and `safeStorage` to `{isEncryptionAvailable:()=>true, encryptString:(s)=>Buffer.from(s), decryptString:(b)=>b.toString()}`.)
- [ ] **Step 2: Run it, confirm fail.** `pnpm --filter @rcw/desktop exec vitest run src/main/config.test.ts`
- [ ] **Step 3: Implement `config.ts`** — read/write `join(app.getPath("userData"), "cowork-config.json")` storing `{serverUrl, tokenEnc: base64}`; encrypt/decrypt the token via `safeStorage`; `loadConfig` returns `{serverUrl, hasToken: !!tokenEnc}` (never the token); `getToken` decrypts.
- [ ] **Step 4: IPC in `main/index.ts`** — `ipcMain.handle("config:get", () => loadConfig())`, `"config:save"` `(_, {serverUrl, token}) => { saveConfig(serverUrl, token); return {ok:true}; }`, `"config:clear"` `() => clearConfig()`.
- [ ] **Step 5: Preload** — expose those three via `ipcRenderer.invoke`.
- [ ] **Step 6: `Login.tsx`** — a centered glass-surface card: server URL input (default `https://cowork.example.com`) + token (password) input + "Connect" `glass-btn--clay`; on submit calls `window.cowork.saveConfig` then signals App to re-check config. `App.tsx`: on mount call `getConfig()`; if null/`!hasToken` render `<Login/>`, else render the cockpit (placeholder until Task 4).
- [ ] **Step 7: Run test + typecheck.** Expected: config test passes; `typecheck` exit 0.
- [ ] **Step 8: Commit** `feat(desktop): secure token store + login screen`.

---

### Task 3: Main API client + SSE bridge + `window.cowork` data API

**Files:**
- Create: `apps/desktop/src/main/api.ts` (authenticated fetch helpers + SSE reader)
- Create: `apps/desktop/src/shared/ipc.ts` (shared IPC channel + payload types)
- Modify: `apps/desktop/src/main/index.ts` (register data IPC + start SSE, forward events to all windows via `webContents.send`)
- Modify: `apps/desktop/src/preload/index.ts` (expose data methods + `onUpdate` subscription)
- Test: `apps/desktop/src/main/api.test.ts`

**Interfaces:**
- Produces (main `api.ts`, all using `getToken()` + stored `serverUrl`): `getSessions()`, `getQueue()`, `getPendingDecisions()`, `resolveDecision(id, resolution)`, `snooze(id, minutes)`, `pin(id, pinned)`. Each does `fetch(serverUrl+path, { headers: { Authorization: 'Bearer '+token }})`; returns parsed JSON or throws.
- Produces: `startStream(onEvent: (e:{type:string;payload:unknown})=>void): () => void` — opens `GET /stream` with the Bearer header via Node `fetch`, reads the streamed body, parses `data: {...}` SSE lines, calls `onEvent`; reconnects on drop with backoff; also a 3s **poll fallback** that emits a synthetic `{type:"session.updated"}` tick. Returns a stop function.
- Produces (preload `window.cowork`): `getSessions/getQueue/getPendingDecisions/resolveDecision/snooze/pin` (Promise-returning, via `ipcRenderer.invoke`), and `onUpdate(cb: () => void): () => void` (subscribes to a `"stream:event"` channel, returns unsubscribe).

- [ ] **Step 1: Failing test `api.test.ts`** — inject a fake `fetch` into the api module (export a `setFetch`/accept a fetch param, or use `vi.stubGlobal("fetch", ...)`). Assert: `getQueue()` calls `serverUrl + "/sessions/queue"` with `Authorization: Bearer <token>` and returns the JSON; `resolveDecision("d1", {choice:"yes",answers:null,custom:null})` POSTs to `/decisions/d1/resolve` with that body; an SSE chunk `data: {"type":"session.updated","payload":{}}\n\n` fed to the stream parser invokes `onEvent` once with the parsed object. Mock `getToken` to return `"tok"` and serverUrl to `"http://x"`.
- [ ] **Step 2: Run it, confirm fail.**
- [ ] **Step 3: Implement `api.ts`** per the interfaces. SSE: `const res = await fetch(url, {headers}); const reader = res.body!.getReader(); ...` accumulate text, split on `\n\n`, for each block strip `data: ` and `JSON.parse`. Wrap in try/reconnect. Keep a parse helper exported for the test.
- [ ] **Step 4: `shared/ipc.ts`** — channel name constants + TS types for each invoke payload/return.
- [ ] **Step 5: IPC + stream in `main/index.ts`** — register `ipcMain.handle` for each data method delegating to `api.ts`; call `startStream` once after a window exists, forwarding every event to `win.webContents.send("stream:event")`. Restart the stream when config changes (after `config:save`).
- [ ] **Step 6: Preload** — expose the data methods + `onUpdate(cb)` (`ipcRenderer.on("stream:event", cb)`; return cleanup).
- [ ] **Step 7: Run test + typecheck.** Expected pass + exit 0.
- [ ] **Step 8: Commit** `feat(desktop): main-process API client + SSE bridge to renderer`.

---

### Task 4: Renderer cockpit — queue rail, focus stage, answer + auto-advance

**Files:**
- Create: `apps/desktop/src/renderer/src/store.ts` (zustand: sessions, queue, decisions, focusId; `refresh()`; `selectNext()`)
- Create: `apps/desktop/src/renderer/src/cockpit/{Cockpit,QueueRail,FocusStage,ContextColumn,AnswerDock}.tsx`
- Create: `apps/desktop/src/renderer/src/autoAdvance.ts` (pure selection logic) + `autoAdvance.test.ts`
- Modify: `App.tsx` (render `<Cockpit/>` when configured)

**Interfaces:**
- `autoAdvance.ts`: `pickFocus(queue: {id:string}[], current: string|null): string|null` — keep `current` if still in `queue`, else the first queue id, else null. `nextAfterAnswer(queue, answeredId): string|null` — first queue id that isn't `answeredId`.
- `store.ts`: `useStore` with `{ sessions, queue, decisions, focusId, refresh, answer(decisionId, resolution), snooze(id,minutes), pin(id,pinned) }`. `refresh()` calls `window.cowork.getQueue/getSessions/getPendingDecisions` in parallel and recomputes `focusId` via `pickFocus`. `answer()` calls `window.cowork.resolveDecision` then `refresh()` and sets focus via `nextAfterAnswer`. Subscribe to `window.cowork.onUpdate(refresh)` once.

- [ ] **Step 1: Failing test `autoAdvance.test.ts`** — assert `pickFocus` keeps a still-present current, falls back to first, returns null on empty; `nextAfterAnswer` returns the first non-answered id (and null when the queue had only the answered one).
- [ ] **Step 2: Run it, confirm fail.**
- [ ] **Step 3: Implement `autoAdvance.ts`.** Run test → pass.
- [ ] **Step 4: Implement `store.ts`** (zustand) wired to `window.cowork`.
- [ ] **Step 5: Build the cockpit components** matching `docs/superpowers/specs/assets/cockpit-focus-theater.html` (Warm Ink, glass classes):
  - `QueueRail` — maps `queue` to chips (project = basename of `cwd`, initials, `waitingSince` → "waiting Nm", amber pulse on focused). Click sets `focusId`.
  - `FocusStage` — header (status pill, session title = repo basename, metadata chips: machine/gitBranch/short id) + the session's `latestAnswer` rendered as the main content + the focused session's pending `Decision` shown in `AnswerDock`.
  - `AnswerDock` (pinned) — the decision's `options` as numbered rows (click → `answer({choice: label})`) + a custom reply input (→ `answer({custom})`) + Skip/Snooze(15m) (→ `snooze`).
  - `ContextColumn` — scrollable `summary` box + session `todos` checklist (read-only checkboxes by status).
- [ ] **Step 6: Wire `App.tsx`** to render `<Cockpit/>`; on mount `refresh()` + subscribe `onUpdate`.
- [ ] **Step 7: Typecheck + renderer build + the unit test.** Expected: `pnpm --filter @rcw/desktop typecheck` exit 0; `build` ok; `vitest run` green.
- [ ] **Step 8: Commit** `feat(desktop): Focus Theater cockpit — queue, stage, answer + auto-advance`.

---

### Task 5: OS notifications + tray + end-to-end polish

**Files:**
- Modify: `apps/desktop/src/main/index.ts` (Tray with waiting count; `new Notification` when a session newly enters waiting — diff the queue across stream ticks; click focuses the window)
- Modify: `apps/desktop/src/renderer/src/cockpit/Cockpit.tsx` ("all clear" rest state when queue empty; Flow/Browse toggle stub)
- Create: `apps/desktop/README.md` (how to run: `pnpm --filter @rcw/desktop dev`; login with the instance token; build with `electron-vite build`)

- [ ] **Step 1: Tray** — `new Tray(icon)`; title/ tooltip shows `${queue.length} waiting`; update on each stream tick (main keeps the last queue length).
- [ ] **Step 2: Notifications** — in main, keep the previous set of waiting session ids; when a new id appears, `new Notification({title:"Claude needs you", body: <repo> + ": " + <decision title>}).show()`; on click, `win.show()/focus()`. Respect a simple on/off (default on).
- [ ] **Step 3: "All clear" rest state** in the renderer when `queue.length===0`.
- [ ] **Step 4: README** with run/build/login instructions.
- [ ] **Step 5: Typecheck + build.** Expected exit 0.
- [ ] **Step 6: Commit** `feat(desktop): tray + OS notifications + all-clear state + README`.

---

## After all tasks

- [ ] `pnpm --filter @rcw/desktop typecheck && pnpm --filter @rcw/desktop test && pnpm --filter @rcw/desktop build` — all green.
- [ ] Manual (user): `pnpm --filter @rcw/desktop dev`, log in to `https://cowork.example.com` with the instance token, confirm the queue renders, answering a real session auto-advances. (Attach a real Claude Code session via the hook to populate the queue.)
- [ ] Report CP2 to Mattermost; push.

## Spec coverage (self-review)
- Electron + shared React renderer + liquid-glass → Task 1. ✓
- See latest answer from anywhere → Task 4 (FocusStage renders `latestAnswer`). ✓
- Queue + auto-advance → Tasks 3–4 (`/sessions/queue` + `pickFocus`/`nextAfterAnswer`). ✓
- Summary + session-todo checklist → Task 4 (ContextColumn). ✓
- Answer (multiple-choice + custom) routed back → Task 4 (`AnswerDock` → `/decisions/:id/resolve`). ✓
- Snooze/pin → Task 4 (wired to CP1 endpoints). ✓
- Notifications when Claude needs attention → Task 5. ✓
- Deferred to later slices (NOT CP2): full transcript scrollback (needs host to stream it — CP3), artifacts (code/image/URL drawer — CP3), file browser/edit (CP3), port-forwarding (CP4), redstone-agent backlog half of the checklist (CP5), Browse mode beyond a stub.
