// Pure builders for the browser "point & prompt" feedback tools. Kept framework-
// free and side-effect-free so the prompt formatting + screenshot pathing are unit
// testable — the DOM capture (selectors, boxes) happens in the injected guest
// script; assembling the agent-facing prompt happens here.

/** One element the user pinned in DOM-feedback (comment/inspect) mode. */
export type DomPin = {
  /** 1-based badge shown in the overlay and the prompt. */
  n: number;
  /** A robust CSS selector for the element, computed in the guest. */
  selector: string;
  /** Readable ancestor chain, e.g. "main > form > button.save". */
  domPath: string;
  /** Trimmed visible text (or a short outerHTML snippet) of the element. */
  text: string;
  /** On-screen box in CSS px. */
  box: { x: number; y: number; w: number; h: number };
  /** Relative path (from the project cwd) of the element's screenshot, if captured. */
  shot?: string | null;
  /** The user's instruction for this element. */
  note: string;
};

/** Collapse whitespace and cap a string so one element's text can't flood the prompt. */
export function clip(s: string, max = 200): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/** Filename-safe UTC stamp, e.g. 2026-07-21T18-40-01-123Z. Injectable date for tests. */
export function stamp(d: Date): string {
  return d.toISOString().replace(/:/g, "-").replace(/\./g, "-");
}

/** Where a screenshot lands: an absolute path on the host (for the write) and the
 * project-relative path (for the prompt, so the agent opens ./.rcw-shots/…). */
export function shotPaths(cwd: string, name: string): { abs: string; rel: string } {
  const root = cwd.replace(/\/+$/, "");
  return { abs: `${root}/.rcw-shots/${name}`, rel: `./.rcw-shots/${name}` };
}

/**
 * Build the single prompt sent to the owning agent for a DOM-feedback review. Lists
 * every pin with the context an agent needs to find the element in source: selector,
 * DOM path, visible text, on-screen box, an optional screenshot path, and the note.
 */
export function buildDomPrompt(url: string, pins: DomPin[]): string {
  const items = pins
    .map((p) => {
      const lines = [
        `${p.n}. \`${p.selector}\`   (${p.domPath})`,
        `   box: x=${Math.round(p.box.x)} y=${Math.round(p.box.y)} w=${Math.round(p.box.w)} h=${Math.round(p.box.h)} · text: ${JSON.stringify(clip(p.text))}`,
      ];
      if (p.shot) lines.push(`   shot: ${p.shot}`);
      lines.push(`   → ${clip(p.note, 600) || "(no note)"}`);
      return lines.join("\n");
    })
    .join("\n\n");
  const n = pins.length;
  return (
    `Visual feedback from the in-app browser on ${url} — ${n} item${n === 1 ? "" : "s"}.\n` +
    `Each item points at a specific element I want changed; the shot paths are PNGs on this machine you can read.\n\n` +
    items
  );
}

/** Build the prompt for a region screenshot: the image path, the URL, the command. */
export function buildRegionPrompt(url: string, shotRel: string, command: string): string {
  return (
    `Screenshot from the in-app browser on ${url}.\n` +
    `Image (readable on this machine): ${shotRel}\n\n` +
    `→ ${clip(command, 800) || "(no command)"}`
  );
}
