import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Renders Claude's markdown output (headings, lists, bold, inline + fenced code,
// tables via GFM) styled to the liquid-glass theme via the `.md` CSS class.
// react-markdown does not render raw HTML by default, so this is XSS-safe.
export default function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
