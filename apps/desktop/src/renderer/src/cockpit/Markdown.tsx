import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

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

const components: Components = {
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

// Renders Claude's markdown output (headings, lists, bold, inline + fenced code,
// tables via GFM) styled to the liquid-glass theme via the `.md` CSS class.
// react-markdown does not render raw HTML by default, so this is XSS-safe.
// Fenced ```diff blocks get per-line +/- coloring.
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
