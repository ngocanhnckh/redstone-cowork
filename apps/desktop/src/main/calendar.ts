import { spawn } from "node:child_process";

// Read the LOCAL Mac's system calendar (all accounts registered in Calendar.app —
// iCloud, Google, Exchange, subscribed .ics) via EventKit through osascript (JXA).
// Shelling out to the Apple-signed `osascript` sidesteps the Info.plist usage-string
// and code-signing requirements our unsigned Electron app would otherwise need, and
// EventKit's predicate query is fast (unlike scripting Calendar.app). macOS only.

export type CalEvent = { title: string; start: string; end: string; allDay: boolean; calendar: string };
export type CalResult = { ok: boolean; denied: boolean; events: CalEvent[] };

// JXA: query events for the next 7 days. When access is already granted (the common
// case) we skip the request entirely — the async completion block is unreliable under
// JXA's single-threaded bridge, but inside the live Electron app its run loop pumps it
// so notDetermined still prompts. Emits a single JSON line. No `${` sequences so this
// is safe inside a template literal.
const JXA = `
ObjC.import('EventKit');
ObjC.import('Foundation');
function run() {
  var st = $.EKEventStore.authorizationStatusForEntityType($.EKEntityTypeEvent);
  var store = $.EKEventStore.alloc.init;
  if (st === 1 || st === 2) return JSON.stringify({ denied: true, events: [] });
  if (st === 0) {
    var done = false, granted = false;
    var cb = function(g){ granted = g; done = true; };
    if (store.respondsToSelector($.NSSelectorFromString('requestFullAccessToEventsWithCompletion:')))
      store.requestFullAccessToEventsWithCompletion(cb);
    else
      store.requestAccessToEntityTypeCompletion($.EKEntityTypeEvent, cb);
    var rl = $.NSRunLoop.currentRunLoop, dl = Date.now() + 12000;
    while (!done && Date.now() < dl) rl.runModeBeforeDate($.NSDefaultRunLoopMode, $.NSDate.dateWithTimeIntervalSinceNow(0.05));
    if (!granted) return JSON.stringify({ denied: true, events: [] });
  }
  var now = $.NSDate.date, end = $.NSDate.dateWithTimeIntervalSinceNow(7 * 24 * 3600);
  var pred = store.predicateForEventsWithStartDateEndDateCalendars(now, end, $());
  var evs = store.eventsMatchingPredicate(pred);
  var fmt = $.NSISO8601DateFormatter.alloc.init;
  var out = [], n = evs ? evs.count : 0;
  for (var i = 0; i < n; i++) {
    var e = evs.objectAtIndex(i);
    out.push({
      title: e.title ? ObjC.unwrap(e.title) : '(no title)',
      start: ObjC.unwrap(fmt.stringFromDate(e.startDate)),
      end: e.endDate ? ObjC.unwrap(fmt.stringFromDate(e.endDate)) : '',
      allDay: !!ObjC.unwrap(e.isAllDay),
      calendar: (e.calendar && e.calendar.title) ? ObjC.unwrap(e.calendar.title) : ''
    });
  }
  return JSON.stringify({ denied: false, events: out.slice(0, 40) });
}
`;

function run(): Promise<string> {
  return new Promise((resolve) => {
    try {
      let out = "";
      const p = spawn("/usr/bin/osascript", ["-l", "JavaScript", "-e", JXA], { env: process.env });
      const kill = setTimeout(() => { try { p.kill(); } catch { /* gone */ } }, 16_000);
      p.stdout.on("data", (d) => (out += d.toString()));
      p.on("error", () => { clearTimeout(kill); resolve(""); });
      p.on("close", () => { clearTimeout(kill); resolve(out); });
    } catch {
      resolve("");
    }
  });
}

// Cache so a widget polling every few minutes (and remounts) don't each spawn osascript.
let cache: { at: number; result: CalResult } | null = null;
const TTL_MS = 90_000;

export async function getCalendarEvents(): Promise<CalResult> {
  if (process.platform !== "darwin") return { ok: false, denied: false, events: [] };
  if (cache && Date.now() - cache.at < TTL_MS) return cache.result;
  try {
    const raw = (await run()).trim();
    const parsed = JSON.parse(raw) as { denied?: boolean; events?: CalEvent[] };
    const result: CalResult = { ok: true, denied: !!parsed.denied, events: Array.isArray(parsed.events) ? parsed.events : [] };
    cache = { at: Date.now(), result };
    return result;
  } catch {
    // Parse/spawn failure — don't cache (transient), report not-ok.
    return { ok: false, denied: false, events: [] };
  }
}
