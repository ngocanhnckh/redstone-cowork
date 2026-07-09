# Session Project-Management (Jira) Integration — Design

**Goal:** Per-session project-management integration. A session can bind to a Jira
project; its current-sprint issues (assigned to the account) show in the todo
window with rich detail, new todos write through to Jira, and the AI assistant can
act on Jira issues. Plus a futuristic progress graph on the todo window and a
per-session Settings tab (repurposed from "Ports").

## Decomposition (3 phases, each shippable on its own)

- **Phase 1 — Foundation (desktop-only, no backend):** todo progress ring + tabbed
  todos (Tasks / Claude), and repurpose the **Ports** tab → **Settings** (per-session)
  with port config as its first section. This spec details Phase 1.
- **Phase 2 — Read-only Jira:** global shared Jira profiles (instance URL + PAT,
  encrypted; clone the `/configs` slice), per-session binding (profile + project
  code, stored server-side so the API's encrypted PAT can sync), current-sprint →
  todo sync (issues assigned to me), and a rich task-detail view (description +
  comments).
- **Phase 3 — Write & AI:** new todos on a connected session create Jira issues
  (assigned to the owner) instead of local; Jira tools for the AI assistant via the
  existing agent tool registry (`agent.service.ts:49` + `redstone.tools.ts`).

Agreed decisions: sync scope = issues assigned to me in the current sprint; Jira
appears as a dedicated section that folds into the "Tasks" tab; the ring measures
the actionable todos shown (active tab); Claude's tasks are tabbed separately from
the user's.

---

## Phase 1 — detailed design

### A. Ports tab → per-session Settings tab

- Rename the tab **"Ports" → "Settings"** (label + icon `⚙`) in the two tab
  registries: `FocusStage.tsx` `TABS` and `Hud.tsx` `FIXED`. **Keep the internal key
  `"ports"`** so per-session active-tab state, window geometry, z-order and the ⌃4
  shortcut are untouched (avoids a rename sweep across state/geometry/persisted tabs).
- New **`SessionSettingsPanel.tsx`** — props `{ sessionId, cwd, machine }`. A
  scrollable, **sectioned** panel. Phase 1 has one section, **"Connection & Ports"**,
  which renders the existing `<PortsPanel>` unchanged (SSH host + port forwarding).
  Structured so Phase 2 adds a **"Project Management"** section as a sibling.
- Render `SessionSettingsPanel` where `PortsPanel` renders today: the Flow
  `activeTab === "ports"` branch (`FocusStage.tsx`) and the HUD `case "ports"`
  (`Hud.tsx`). `PortsPanel` itself is not modified.
- Named `SessionSettingsPanel` to avoid collision with the existing app-level
  `SettingsPanel.tsx` (connection/appearance modal).

### B. Tabbed todos + progress ring (`ContextColumn.tsx`)

- **Tab switcher** at the top of the "Session todos" area, two tabs:
  - **"Tasks"** — user todos (`session.userTodos`); Phase 2 folds Jira sprint issues
    into this tab.
  - **"Claude"** — Claude's plan todos (`session.todos`), read-only, as today.
  - Each tab label carries a count badge, e.g. `Tasks · 3/8`, `Claude · 5/12`, so both
    are visible without switching. Active-tab state is component-local
    (`useState`), default "Tasks".
- **Progress ring** above the tabs, **reflecting the active tab**:
  - Tasks → user todos `done/total`; Claude → plan `completed/total`.
  - New `TodoProgress` component: a futuristic SVG donut — faint full-circle track +
    a glowing gradient foreground arc (theme `--primary-soft`→`--accent`), a soft
    outer glow/pulse, center label `done/total` and small `%`.
  - Backed by a pure helper `todoProgress(items: {done:boolean}[]) → {done,total,pct}`
    (unit-testable; `pct = total ? round(done/total*100) : 0`).
  - When the active tab has 0 items, the ring collapses to a slim "no tasks yet"
    line (no divide-by-zero, no empty donut).
- Applies in both `ContextColumn` render sites: the Flow right rail (below the
  summary) and the HUD "Tasks" window (`hideSummary`).
- The plan-todo rendering (`PlanRow`) and user-todo rendering (`UserRow`, add/toggle/
  delete) are unchanged — only relocated under their respective tabs.

### Data shapes (existing, unchanged in Phase 1)

- `UserTodo = { id: string; text: string; done: boolean }` (`session.userTodos`).
- `Todo = { text: string; status: "pending" | "in_progress" | "completed" }`
  (`session.todos`). For the Claude ring, "done" = `status === "completed"`.

### Error handling

- Empty lists → ring hidden / "no tasks yet"; percentage guards against divide-by-zero.
- No new IO in Phase 1, so no new failure modes; PortsPanel keeps its own handling.

### Testing

- Unit test `todoProgress()`: empty → `{0,0,0}`; partial → correct done/total/pct;
  all done → `100`.
- Rest verified by `pnpm typecheck` + `pnpm build` + reload. No backend/API changes.

### Out of scope for Phase 1

Any Jira code, backend changes, the "Project Management" settings section, sprint
sync, task detail, write-through, and assistant tools — all Phase 2/3.
