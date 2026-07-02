import { CapItem, CapsHostView } from "../types";

/** Merge a kind of capability across hosts (or one machine), de-duped by name. */
function merge(caps: CapsHostView[], machine: string | null | undefined, pick: (h: CapsHostView) => CapItem[]): CapItem[] {
  const rows = machine ? caps.filter((h) => h.machine === machine) : caps;
  const seen = new Map<string, CapItem>();
  for (const h of rows) for (const c of pick(h)) if (!seen.has(c.name)) seen.set(c.name, c);
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const commandsFor = (caps: CapsHostView[], machine?: string | null) => merge(caps, machine, (h) => h.commands);
export const skillsFor = (caps: CapsHostView[], machine?: string | null) => merge(caps, machine, (h) => h.skills);
