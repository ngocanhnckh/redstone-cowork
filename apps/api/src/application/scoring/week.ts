// Week math for the scoring board. The competition week is Monday 00:00 → Sunday 23:59 in
// a configured IANA timezone (default Asia/Ho_Chi_Minh). All arithmetic goes through `Intl`
// so a late-Sunday-UTC instant that is already Monday in ICT files into the correct week —
// the old UTC-only `currentWeek()` in agency.service.ts would misfile it.

const pad2 = (n: number) => String(n).padStart(2, "0");

/** The tz offset (localWallClock − UTC) in ms at `date`, via formatting the instant into the
 *  zone and reading it back as if it were UTC. Correct across DST for zones that observe it. */
function tzOffsetMs(timeZone: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== "literal") map[p.type] = p.value;
  const asUtc = Date.UTC(+map.year, +map.month - 1, +map.day, +map.hour, +map.minute, +map.second);
  return asUtc - date.getTime();
}

/** The UTC instant of a wall-clock time in `timeZone` (with one DST-boundary refinement). */
function zonedToUtc(y: number, m1: number, d: number, h: number, timeZone: string): Date {
  const guess = Date.UTC(y, m1, d, h, 0, 0);
  let utc = guess - tzOffsetMs(timeZone, new Date(guess));
  const off2 = tzOffsetMs(timeZone, new Date(utc));
  const off1 = guess - utc;
  if (off2 !== off1) utc = guess - off2;
  return new Date(utc);
}

/** The local calendar parts + Monday-0 weekday index of `instant` in `timeZone`. */
function localParts(instant: Date, timeZone: string): { y: number; m: number; d: number; dow: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(instant)) if (p.type !== "literal") map[p.type] = p.value;
  const idx: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  return { y: +map.year, m: +map.month, d: +map.day, dow: idx[map.weekday] ?? 0 };
}

/** The week key (the Monday, "YYYY-MM-DD") of the week containing `instant` in `timeZone`. */
export function weekKeyOf(instant: Date, timeZone: string): string {
  const { y, m, d, dow } = localParts(instant, timeZone);
  // Day arithmetic on the floating local date (as UTC) — normalises month/year rollover.
  const monday = new Date(Date.UTC(y, m - 1, d - dow));
  return `${monday.getUTCFullYear()}-${pad2(monday.getUTCMonth() + 1)}-${pad2(monday.getUTCDate())}`;
}

/** The [Mon 00:00, next-Mon 00:00) UTC window for a week key, in `timeZone`. */
export function weekWindow(weekKey: string, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = weekKey.split("-").map(Number);
  const start = zonedToUtc(y, m - 1, d, 0, timeZone);
  const next = new Date(Date.UTC(y, m - 1, d + 7));
  const end = zonedToUtc(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), 0, timeZone);
  return { start, end };
}
