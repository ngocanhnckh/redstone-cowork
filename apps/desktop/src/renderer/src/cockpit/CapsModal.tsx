import { useMemo, useState } from "react";
import { useStore } from "../store";
import { CapItem } from "../types";

function Row({ c, prefix }: { c: CapItem; prefix?: string }) {
  return (
    <div style={{ padding: "9px 11px", borderRadius: 9, background: "rgb(var(--primary) / 0.04)", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="mono" style={{ fontSize: 12.5, color: "rgb(var(--accent))" }}>{prefix}{c.name}</span>
        <span style={{ flex: 1 }} />
        <span className="mono faint" style={{ fontSize: 9 }}>{c.source}</span>
      </div>
      {c.description && (
        <div className="faint" style={{ fontSize: 11, marginTop: 3, lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {c.description}
        </div>
      )}
    </div>
  );
}

/** Searchable browser of installed skills + slash commands across all hosts. */
export default function CapsModal() {
  const open = useStore((s) => s.capsOpen);
  const toggle = useStore((s) => s.toggleCaps);
  const caps = useStore((s) => s.caps);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"commands" | "skills">("commands");

  // Merge across hosts, de-duped by name.
  const { commands, skills } = useMemo(() => {
    const cmd = new Map<string, CapItem>();
    const skl = new Map<string, CapItem>();
    for (const h of caps) {
      for (const c of h.commands) if (!cmd.has(c.name)) cmd.set(c.name, c);
      for (const s of h.skills) if (!skl.has(s.name)) skl.set(s.name, s);
    }
    const byName = (a: CapItem, b: CapItem) => a.name.localeCompare(b.name);
    return { commands: [...cmd.values()].sort(byName), skills: [...skl.values()].sort(byName) };
  }, [caps]);

  if (!open) return null;

  const ql = q.trim().toLowerCase();
  const filter = (list: CapItem[]) => (ql ? list.filter((c) => c.name.toLowerCase().includes(ql) || (c.description ?? "").toLowerCase().includes(ql)) : list);
  const list = filter(tab === "commands" ? commands : skills);

  const tabBtn = (t: "commands" | "skills", label: string, n: number) => (
    <button onClick={() => setTab(t)} style={{
      padding: "6px 13px", borderRadius: 8, fontFamily: "var(--font-mono)", fontSize: 12, cursor: "pointer", border: 0,
      background: tab === t ? "rgb(var(--primary) / 0.28)" : "transparent", color: tab === t ? "#fff" : "var(--text-soft)",
    }}>{label} <span className="faint">· {n}</span></button>
  );

  return (
    <div onClick={toggle} style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="glass-soft" onClick={(e) => e.stopPropagation()} style={{ width: 640, maxWidth: "94vw", maxHeight: "84vh", borderRadius: 16, border: "1px solid var(--border-strong)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 20px 12px", borderBottom: "1px solid var(--border)" }}>
          <span className="display" style={{ fontSize: 17 }}>Skills &amp; Commands</span>
          <div style={{ display: "flex", gap: 3, padding: 3, borderRadius: 999, border: "1px solid var(--border)", marginLeft: 6 }}>
            {tabBtn("commands", "Commands", commands.length)}
            {tabBtn("skills", "Skills", skills.length)}
          </div>
          <span style={{ flex: 1 }} />
          <button onClick={toggle} style={{ border: "1px solid var(--border)", background: "transparent", color: "var(--text-soft)", borderRadius: 8, width: 28, height: 28, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ padding: "12px 20px 0" }}>
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${tab}…`}
            style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--border)", background: "transparent", borderRadius: 10, padding: "9px 13px", fontSize: 13, color: "var(--text)", outline: "none" }} />
        </div>
        <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", padding: "12px 20px 18px", display: "flex", flexDirection: "column", gap: 6 }}>
          {caps.length === 0 ? (
            <span className="mono faint" style={{ fontSize: 12, lineHeight: 1.5 }}>No capabilities reported yet. The <span className="mono" style={{ color: "var(--text)" }}>redstone agent</span> scans installed skills/commands on each host.</span>
          ) : list.length === 0 ? (
            <span className="mono faint" style={{ fontSize: 12 }}>No {tab} match “{q}”.</span>
          ) : list.map((c) => <Row key={c.source + c.name} c={c} prefix={tab === "commands" ? "/" : ""} />)}
        </div>
      </div>
    </div>
  );
}
