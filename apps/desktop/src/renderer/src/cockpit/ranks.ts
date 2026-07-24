// Military rank ladder for YITEC agents — shared by the admin roster (Level dropdown)
// and the agent identity card (rank + insignia). Ordered junior → senior; the insignia
// is a compact glyph strip (chevrons for enlisted, bars/diamonds for officers, stars
// for generals) rendered on the card instead of a plain pill.

export type Rank = { name: string; insignia: string; tier: "enlisted" | "officer" | "general" };

export const RANKS: Rank[] = [
  { name: "Recruit", insignia: "", tier: "enlisted" },
  { name: "Private", insignia: "∨", tier: "enlisted" },
  { name: "Corporal", insignia: "∨∨", tier: "enlisted" },
  { name: "Sergeant", insignia: "∨∨∨", tier: "enlisted" },
  { name: "Staff Sergeant", insignia: "∨∨∨∨", tier: "enlisted" },
  { name: "Warrant Officer", insignia: "◆", tier: "officer" },
  { name: "Lieutenant", insignia: "❙", tier: "officer" },
  { name: "First Lieutenant", insignia: "❙❙", tier: "officer" },
  { name: "Captain", insignia: "❙❙❙", tier: "officer" },
  { name: "Major", insignia: "✦", tier: "officer" },
  { name: "Lieutenant Colonel", insignia: "✦✦", tier: "officer" },
  { name: "Colonel", insignia: "✦✦✦", tier: "officer" },
  { name: "Brigadier General", insignia: "★", tier: "general" },
  { name: "Major General", insignia: "★★", tier: "general" },
  { name: "Lieutenant General", insignia: "★★★", tier: "general" },
  { name: "General", insignia: "★★★★", tier: "general" },
];

export const RANK_NAMES = RANKS.map((r) => r.name);

/** Look up a rank by name (case-insensitive); null for empty/unknown labels. */
export function findRank(label: string | null | undefined): Rank | null {
  if (!label) return null;
  const l = label.trim().toLowerCase();
  return RANKS.find((r) => r.name.toLowerCase() === l) ?? null;
}
