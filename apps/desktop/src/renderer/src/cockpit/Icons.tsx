// Small inline SVG icon set — stroke-based, inherits `color` via currentColor and
// sizes to `size` (default 16). Replaces emoji in the UI so icons render crisply and
// consistently in light/dark themes instead of the OS's colourful emoji glyphs.
import type { CSSProperties } from "react";

type IconProps = { size?: number; style?: CSSProperties; title?: string };

function Svg({ size = 16, style, title, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: "block", ...style }}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const IconMenu = (p: IconProps) => (
  <Svg {...p}><line x1="2.5" y1="4.5" x2="13.5" y2="4.5" /><line x1="2.5" y1="8" x2="13.5" y2="8" /><line x1="2.5" y1="11.5" x2="13.5" y2="11.5" /></Svg>
);

// Incognito — a pair of glasses (private browsing).
export const IconIncognito = (p: IconProps) => (
  <Svg {...p}><path d="M2 7.5 L4.5 4.5 H11.5 L14 7.5" /><circle cx="4.8" cy="10" r="2.1" /><circle cx="11.2" cy="10" r="2.1" /><path d="M6.9 10 h2.2" /></Svg>
);

export const IconKey = (p: IconProps) => (
  <Svg {...p}><circle cx="5.5" cy="10.5" r="3" /><path d="M7.7 8.3 L13.5 2.5" /><path d="M11 5 l1.6 1.6" /><path d="M12.3 3.7 l1.4 1.4" /></Svg>
);

export const IconPuzzle = (p: IconProps) => (
  <Svg {...p}><path d="M6.2 2.6 a1.4 1.4 0 0 1 2.8 0 v1.2 h2.2 a1 1 0 0 1 1 1 v2.2 h1.2 a1.4 1.4 0 0 1 0 2.8 h-1.2 v2.2 a1 1 0 0 1-1 1 H5 a1 1 0 0 1-1-1 v-2.2 H2.8 a1.4 1.4 0 0 1 0-2.8 H4 V4.8 a1 1 0 0 1 1-1 h1.2 z" /></Svg>
);

export const IconLaptop = (p: IconProps) => (
  <Svg {...p}><rect x="3" y="3.5" width="10" height="7" rx="1" /><path d="M1.5 13 h13" /></Svg>
);

export const IconPhone = (p: IconProps) => (
  <Svg {...p}><rect x="5" y="2" width="6" height="12" rx="1.5" /><line x1="7.2" y1="12" x2="8.8" y2="12" /></Svg>
);

export const IconPlus = (p: IconProps) => (
  <Svg {...p}><line x1="8" y1="3.2" x2="8" y2="12.8" /><line x1="3.2" y1="8" x2="12.8" y2="8" /></Svg>
);

export const IconMinus = (p: IconProps) => (
  <Svg {...p}><line x1="3.2" y1="8" x2="12.8" y2="8" /></Svg>
);

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}><path d="M4 6 L8 10 L12 6" /></Svg>
);

export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}><path d="M2 8 s2.4-4 6-4 6 4 6 4-2.4 4-6 4-6-4-6-4Z" /><circle cx="8" cy="8" r="1.6" /><line x1="2.5" y1="2.5" x2="13.5" y2="13.5" /></Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}><path d="M13 3.5 v3 h-3" /><path d="M12.5 8 a4.6 4.6 0 1 1-1.3-3.2 L13 6.5" /></Svg>
);

// Open in new window — a window frame with an arrow leaving it.
export const IconExternal = (p: IconProps) => (
  <Svg {...p}><path d="M8 3 H3.5 A1 1 0 0 0 2.5 4 v8 a1 1 0 0 0 1 1 h8 a1 1 0 0 0 1-1 V8" /><path d="M9.5 2.5 H13.5 V6.5" /><path d="M13.5 2.5 L7.5 8.5" /></Svg>
);

// Comment / annotate: a speech bubble with a small pin dot (DOM-feedback mode).
export const IconComment = (p: IconProps) => (
  <Svg {...p}><path d="M2.5 4.5 a1 1 0 0 1 1-1 h9 a1 1 0 0 1 1 1 v5 a1 1 0 0 1-1 1 H7 l-3 2.5 V10.5 H3.5 a1 1 0 0 1-1-1 Z" /><circle cx="8" cy="7" r="0.9" fill="currentColor" stroke="none" /></Svg>
);

// Region screenshot: a crop / marquee frame (visual-feedback mode).
export const IconCrop = (p: IconProps) => (
  <Svg {...p}><path d="M4.5 1.5 V11 a1 1 0 0 0 1 1 H14.5" /><path d="M1.5 4.5 H11 a1 1 0 0 1 1 1 V14.5" /></Svg>
);
