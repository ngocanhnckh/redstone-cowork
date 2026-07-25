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

export const IconTrophy = (p: IconProps) => (
  <Svg {...p}><path d="M5 2.5 h6 v4 a3 3 0 0 1-6 0 Z" /><path d="M5 3.5 H2.8 a2.2 2.2 0 0 0 2.4 2.6" /><path d="M11 3.5 h2.2 a2.2 2.2 0 0 1-2.4 2.6" /><path d="M8 9.5 v2" /><path d="M5.5 13.5 h5" /><path d="M6.5 11.5 h3 l.5 2 h-4 Z" /></Svg>
);

export const IconGift = (p: IconProps) => (
  <Svg {...p}><rect x="2.5" y="5.5" width="11" height="3" /><path d="M3.5 8.5 v5 h9 v-5" /><path d="M8 5.5 v8" /><path d="M8 5.5 C8 3.5 6.8 2.3 5.6 2.3 a1.5 1.5 0 0 0 0 3.2" /><path d="M8 5.5 C8 3.5 9.2 2.3 10.4 2.3 a1.5 1.5 0 0 1 0 3.2" /></Svg>
);

export const IconCrown = (p: IconProps) => (
  <Svg {...p}><path d="M2.5 4.5 L5.2 7.2 L8 3.2 L10.8 7.2 L13.5 4.5 V11 H2.5 Z" /><path d="M2.5 13 h11" /></Svg>
);

// Docker / containers — a stack of boxes (container deck).
export const IconContainer = (p: IconProps) => (
  <Svg {...p}><rect x="2" y="7" width="3.4" height="3" /><rect x="6.3" y="7" width="3.4" height="3" /><rect x="10.6" y="7" width="3.4" height="3" /><rect x="6.3" y="3" width="3.4" height="3" /><path d="M2 12.5 h12" /></Svg>
);

export const IconPaperclip = (p: IconProps) => (
  <Svg {...p}><path d="M11.5 7 L7.3 11.2 a2.4 2.4 0 0 1-3.4-3.4 L8.6 3.1 a1.7 1.7 0 0 1 2.4 2.4 L6.4 10" /></Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p}><rect x="3.5" y="7" width="9" height="6.5" rx="1" /><path d="M5.5 7 V5 a2.5 2.5 0 0 1 5 0 v2" /><circle cx="8" cy="10.2" r="0.9" fill="currentColor" stroke="none" /></Svg>
);

export const IconGlobe = (p: IconProps) => (
  <Svg {...p}><circle cx="8" cy="8" r="5.8" /><ellipse cx="8" cy="8" rx="2.6" ry="5.8" /><path d="M2.4 8 h11.2" /></Svg>
);

export const IconMonitor = (p: IconProps) => (
  <Svg {...p}><rect x="2" y="3" width="12" height="8" rx="1" /><path d="M6 13.5 h4" /><path d="M8 11 v2.5" /></Svg>
);

// Satellite dish — network / uplink map.
export const IconSatellite = (p: IconProps) => (
  <Svg {...p}><path d="M3 8.5 a5.5 5.5 0 0 0 9.6 3.6 L4.4 4 A5.5 5.5 0 0 0 3 8.5 Z" /><path d="M7.5 8.5 l5-5" /><circle cx="13" cy="3" r="1" /><path d="M6 13.8 h4.5" /></Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}><circle cx="7" cy="7" r="4.2" /><path d="M10.2 10.2 L13.8 13.8" /></Svg>
);

export const IconTrash = (p: IconProps) => (
  <Svg {...p}><path d="M2.8 4.5 h10.4" /><path d="M6 4.5 V3 h4 v1.5" /><path d="M4.2 4.5 l.6 9 h6.4 l.6-9" /><path d="M6.6 7 v4" /><path d="M9.4 7 v4" /></Svg>
);

export const IconCheckCircle = (p: IconProps) => (
  <Svg {...p}><circle cx="8" cy="8" r="5.8" /><path d="M5.3 8.2 L7.2 10 L10.8 6" /></Svg>
);
