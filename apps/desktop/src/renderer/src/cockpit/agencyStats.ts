// Agency scorecard model — the maths behind the Arena/Dossier ratings. Kept in its OWN
// module (no components) so AgencyView and AgencyProfile both import it WITHOUT a circular
// dependency (AgencyView → AgencyProfile → here, not back to AgencyView).

export type Analytics = {
  accountId: string; username: string; displayName: string; role: string;
  photo: string | null; level: string; division: string;
  sessions: number; activeSessions: number; tokensInput: number; tokensOutput: number;
  estCostUsd: number; timeSpentMs: number; lastActiveAt: string | null;
};

// Rating curve: a saturating hyperbola  99·x/(x+half).  `half` is the value that scores
// ~50; reaching 90 needs 9×half, so it APPROACHES but rarely hits 99 — a heavy performer
// lands in the high-80s/low-90s WITH variation, not a flat wall of 99s.
function rate(x: number, half: number): number {
  if (x <= 0) return 1;
  return Math.max(1, Math.min(99, Math.round((99 * x) / (x + half))));
}

// The scorecard is built from REAL long-run signals — GitHub (contributions, consistency)
// and Jira (delivery, workload) — with cowork tokens only a minor factor (that telemetry
// only just started, so it can't be the backbone of ranking).
export type Stats = { DEL: number; COD: number; CON: number; WRK: number; THR: number };
export type StatInput = { done: number; jiraTotal: number; ghContrib: number; ghActiveDays: number; tokensOut: number };
const HALF = { del: 45, cod: 320, con: 110, wrk: 90, thr: 2_000_000 };
export const STAT_LABELS: Array<{ key: keyof Stats; short: string; long: string }> = [
  { key: "DEL", short: "DEL", long: "DELIVERY" },   // Jira issues completed
  { key: "COD", short: "COD", long: "CODE" },        // GitHub contributions (last year)
  { key: "CON", short: "CON", long: "CONSISTENCY" }, // GitHub active days
  { key: "WRK", short: "WRK", long: "WORKLOAD" },    // Jira issues assigned
  { key: "THR", short: "THR", long: "THROUGHPUT" },  // cowork tokens (minor)
];
export function ratingsFor(x: StatInput): Stats {
  return {
    DEL: rate(x.done, HALF.del),
    COD: rate(x.ghContrib, HALF.cod),
    CON: rate(x.ghActiveDays, HALF.con),
    WRK: rate(x.jiraTotal, HALF.wrk),
    THR: rate(x.tokensOut, HALF.thr),
  };
}
export const ovrOf = (s: Stats): number => Math.round(s.DEL * 0.28 + s.COD * 0.26 + s.CON * 0.20 + s.WRK * 0.14 + s.THR * 0.12);
