# Themed Apps + Floating Widget Layer — Design

**Date:** 2026-07-23
**Surface:** Electron cockpit desktop (`apps/desktop`), HUD mode + custom apps.

Two independent, self-contained features. Renderer-only except for **one** new
main-process command (an `ss -tn` host-peers reader for the Recon Radar, mirroring the
existing `getHostIps`); everything else reuses data already in the HUD. No NestJS API
changes.

---

## Feature 1 — Themed custom apps

Let a saved custom app (Grafana, Jira, …) be restyled to match the cockpit theme by
injecting CSS into its `<webview>` guest.

### Data model
Extend `CustomApp` (`cockpit/CustomAppPanel.tsx`):
```ts
theme?: "off" | "dark" | "hitech";  // default "off"
customCss?: string | null;          // optional, appended last (always wins)
```
Persisted with the existing `rcw.customApps` localStorage list — old apps without the
fields default to `off`/none.

### CSS generator — `cockpit/appTheme.ts` (new)
`export function themeCss(mode: "off"|"dark"|"hitech", custom?: string|null): string`
- `off` → returns `custom ?? ""` (custom CSS still applies even with no theme).
- `dark` → universal Dark-Reader-lite:
  - `html { background:#0e0d0c !important; }`
  - `html { filter: invert(1) hue-rotate(180deg) !important; }`
  - re-invert media so photos/logos read correctly:
    `img,video,picture,canvas,svg image,[style*="background-image"] { filter: invert(1) hue-rotate(180deg) !important; }`
- `hitech` → the `dark` base **plus** a cyan-holographic pass:
  - cyan text selection (`::selection`), cyan links/buttons/focus outlines,
    cyan thin scrollbars.
  - a `pointer-events:none; position:fixed; inset:0; z-index:2147483647` overlay
    (injected as a `body::after`-style fixed layer via CSS) with a faint scanline
    `repeating-linear-gradient` + radial vignette. Non-interactive so the app still works.
  - Note: cyan values are hard-coded hex (the guest can't read our CSS vars).
- Custom CSS is concatenated **after** the theme block in all modes.

### Injection — `CustomAppPanel.tsx`
- Keep a ref to the last inserted-CSS key.
- On `dom-ready` (fires per document / hard nav): `removeInsertedCSS(key)` if any,
  then `key = await wv.insertCSS(themeCss(app.theme, app.customCss))` when the result
  is non-empty.
- A separate effect re-applies on `[app.theme, app.customCss]` change so retheming is
  **live, no reload** (remove old key, insert new).
- Guarded in try/catch (guest may not be ready) — never throws.

### UI — `AppsModal.tsx` + `Hud.tsx`
- New handler `updateApp(id, patch)` in `Hud.tsx` (mirrors `addApp`/`removeApp`;
  `setApps(a => a.map(x => x.id===id ? {...x, ...patch} : x))`), passed to `AppsModal`.
- `AppsModal`: for **each existing app row** and in the **Add form**, add:
  - a segmented control **Off · Dark · Hi-tech** bound to `theme`.
  - a collapsible **Custom CSS** `<textarea>` (mono, monaco not needed) bound to
    `customCss`.
- Add-form state gains `theme` + `customCss`; included in the `onAdd` payload.

Theming applies to **custom apps only** — general Browser tabs are left untouched.

---

## Feature 2 — Floating widget layer

Keep the fixed right-hand telemetry deck. Add a **free-floating widget canvas** over
the HUD backdrop with a picker. All widgets are NEW (no clones of the deck or the left
column). Set to build: **Attention Radar, Fleet Burn ($), Activity Ticker, Focus
Timer, Scratch Note, Throughput, Recon Radar** (Model Mix skipped).

### Model
Persisted globally in `localStorage` `rcw.widgets`:
```ts
type WidgetKind = "attention" | "burn" | "ticker" | "timer" | "scratch" | "throughput" | "radar";
type WidgetInst = { id: string; kind: WidgetKind; x: number; y: number; w: number; h: number };
```
Placement is global; session-scoped content reads `focusId`/`sessions` from the store
exactly like the deck widgets do today.

### Layer & frame — `cockpit/WidgetLayer.tsx` (new)
- Absolutely positioned over `hud-root`, **z-index below the app windows** (ambient;
  windows sit on top) and above the `hud-grid` backdrop.
- `WidgetLayer` owns the `WidgetInst[]` state (load/save to `rcw.widgets`), renders a
  `WidgetFrame` per instance, and a `＋ widgets` picker button (placed in the telemetry
  column header).
- `WidgetFrame`: self-contained pointer drag (grip that appears on hover) + corner
  resize handle + hover ✕ remove. Clamped to the layer bounds. Hi-tech glass styling
  (`hud-card` look). Chrome only visible on hover so the canvas stays clean.
- Picker: small popover listing the catalog; clicking adds an instance at a cascading
  default offset. A kind already placed can be added again (multiple scratch notes ok).
- `WidgetLayer` receives `tele` as a prop is NOT needed — none of the 7 chosen widgets
  use host telemetry; all read the store directly.

### Widget content components (all in `WidgetLayer.tsx` or a `widgets/` folder)
Each reads the store via `useStore` selectors:
1. **Attention Radar** — `decisions.filter(kind ∈ {question,permission,mode})` joined to
   their session; rank by `waitingSince` age (fallback: decision order). Row = session
   name + `waited Xm Ys` + a pulse whose speed scales with wait time. Empty state:
   "all clear". Ticks every 1s for the clock.
2. **Fleet Burn ($)** — sum over `sessions` of
   `tokensInput/1e6 * rate.in + tokensOutput/1e6 * rate.out` using a small per-model USD
   rate table (Opus/Sonnet/Haiku; default fallback rate). Shows **$ total** + **$/hr**
   burn (delta of total ÷ elapsed, sampled in a ref over ~a minute) + a tiny sparkline.
3. **Activity Ticker** — newest assistant activity across sessions: take each session's
   last `transcript` assistant `text`, sort by recency (session `lastSeenAt`), render a
   CSS marquee `machine › <snippet> · …`. Pauses on hover.
4. **Focus Timer** — local Pomodoro (25/5). Start/pause/reset, countdown ring (SVG),
   session count. State in `useState`; no persistence needed (a running timer resets on
   reload — acceptable) — but the chosen length persists in `rcw.widgets`? No: keep
   purely local for v1.
5. **Scratch Note** — a `<textarea>` persisted per-widget-instance in `rcw.widgets`
   (add `text?: string` to `WidgetInst`) so each sticky keeps its own content.
6. **Throughput** — from all sessions' `tokenSeries` (`{t,input,output}`), bucket the
   last ~15 min into per-minute totals → `tok/min` big number + sparkline. Recompute on
   an interval.
7. **Recon Radar** — a rotating sweep whose blips are the IPs the focused session's
   remote host has recently interacted with (established TCP peers). Hovering a blip
   shows the IP (+ peer port / connection count). Empty/loopback-only → "no external
   peers". See the new data source below.

   **Data source (small SSH-backed addition):** mirror `main/host-info.ts` with
   `getHostConnections(machine)` running `ss -tn 2>/dev/null` (fallback
   `netstat -tn`) locally or over SSH; parse the peer column (last `IPv4:port` per
   line), drop loopback (`127.0.0.1`/`::1`), dedup by IP with an occurrence `count`,
   cap ~40. Returns `Array<{ ip: string; port: number | null; count: number }>`.
   Wire it: `IPC.hostConnections = "api:host:connections"` (`shared/ipc.ts`),
   `ipcMain.handle` in `main/index.ts`, `hostConnections(machine)` in
   `preload/index.ts`, and the type in `renderer/src/cowork.d.ts`. Best-effort,
   never throws (empty array on any failure).

   **Render:** circular radar + rotating sweep line (SVG/CSS). Each peer = a blip
   whose angle+radius are deterministic from a hash of the IP (stable across polls),
   radius optionally scaled by `count`. A blip flares as the sweep passes its angle.
   Hover → tooltip `ip · :port · ×count`. Header shows host name + peer count. Poll
   every ~5s for the focused session's `machine`; clear on unmount; skip when no
   focused session.

### Mount point — `Hud.tsx` `HudRoot`
Render `<WidgetLayer />` inside `hud-root` (the `rootRef` div), after `hud-grid` and
before/below the windows layer, so it overlays the backdrop but sits under app windows.
Add the `＋ widgets` control to the `TelemetryColumn` header.

### Performance
- Widgets honor the existing `body.rcw-hidden` pause convention (park animations when
  the window is hidden) by using `hud-*` animation classes or `animation-play-state`
  hooks where they animate.
- Interval-driven widgets clear their timers on unmount.

---

## Out of scope (v1)
- Model Mix widget (user deselected).
- Theming the general Browser panel.
- Weather / Calendar widgets (no connector to back them).
- Per-site theme memory for Browser tabs.
