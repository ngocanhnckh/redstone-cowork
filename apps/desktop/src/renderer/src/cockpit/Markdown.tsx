import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../store";

// Color each line of a ```diff fenced block: additions green, removals red,
// everything else default. Keeps the monospace layout react-markdown gives us.
function DiffCode({ text }: { text: string }) {
  const lines = text.replace(/\n$/, "").split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const color = line.startsWith("+")
          ? "rgb(var(--accent))"
          : line.startsWith("-")
            ? "#e0736a"
            : undefined;
        return (
          <span key={i} style={color ? { color } : undefined}>
            {line}
            {i < lines.length - 1 ? "\n" : ""}
          </span>
        );
      })}
    </>
  );
}

// A plain left-click on a chat/preview link opens it in the focused session's
// IN-APP workspace browser (a new tab) rather than kicking out to the OS browser.
// Modifier-clicks (⌘/Ctrl/Shift), middle-click, and right-click fall through to
// default handling — the main-process context menu still offers "Open in Real
// Browser". Non-http(s) links (mailto:, etc.) also fall through to the OS.
function onLinkClick(e: React.MouseEvent<HTMLAnchorElement>, href?: string) {
  if (!href) return;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  if (!/^https?:\/\//i.test(href)) return; // let the OS handle mailto:/tel:/etc.
  e.preventDefault();
  const st = useStore.getState();
  const sid = st.focusId;
  if (sid) {
    st.openUrlInBrowser(sid, href);
    if (st.mode !== "hud") st.setActiveTab(sid, "browser");
  } else {
    window.cowork.openExternal(href).catch(() => {});
  }
}

const components: Components = {
  a({ href, children, ...props }) {
    return (
      <a href={href} {...props} onClick={(e) => onLinkClick(e, href)}>
        {children}
      </a>
    );
  },
  code({ className, children, ...props }) {
    if (className?.includes("language-diff")) {
      return (
        <code className={className} {...props}>
          <DiffCode text={String(children)} />
        </code>
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

// Above this, parsing markdown into a React tree gets heavy enough to stutter the
// single renderer thread — so we render it as plain text instead. Real chat messages
// are capped far below this; only pathological content (a huge pasted blob / file)
// trips it, and a frozen app is worse than unformatted text.
const MD_MAX = 80_000;

// Renders Claude's markdown output (headings, lists, bold, inline + fenced code,
// tables via GFM) styled to the liquid-glass theme via the `.md` CSS class.
// react-markdown does not render raw HTML by default, so this is XSS-safe.
// Fenced ```diff blocks get per-line +/- coloring.
export default function Markdown({ children }: { children: string }) {
  if (children && children.length > MD_MAX) {
    // Defensive: never let one giant blob block the whole UI. Show it as plain text.
    return <pre className="md" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>{children}</pre>;
  }
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
