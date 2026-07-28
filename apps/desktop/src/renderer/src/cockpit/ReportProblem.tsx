import { useState } from "react";

// Always-available "Report a problem" affordance: bundles the rolling debug log + app/OS context
// and submits it to the cowork server, which stores it for triage (and emails the
// dev too when SMTP is configured). Optional one-line note.

export default function ReportProblem() {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    setBusy(true); setResult(null);
    try {
      const r = await window.cowork.reportBug(note.trim() || undefined);
      setResult(r.ok ? { ok: true, text: r.to ? `Submitted — also emailed to ${r.to}. Thank you.` : "Submitted to the server — thank you." } : { ok: false, text: r.error || "Couldn't submit." });
      if (r.ok) { setNote(""); setTimeout(() => { setOpen(false); setResult(null); }, 2200); }
    } catch (e) {
      setResult({ ok: false, text: e instanceof Error ? e.message : "Couldn't send." });
    } finally { setBusy(false); }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} title="Submit a debug log to the cowork server"
        style={{ width: "100%", marginTop: 8, padding: "8px 10px", borderRadius: 10, cursor: "pointer",
          border: "1px solid var(--border)", background: "transparent", color: "var(--text-faint)",
          fontFamily: "var(--font-mono)", fontSize: 10.5, letterSpacing: "0.08em", display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ color: "#e0a44a" }}>⚠</span> REPORT A PROBLEM
      </button>
    );
  }
  return (
    <div style={{ marginTop: 8, padding: 10, borderRadius: 12, border: "1px solid var(--border)", background: "rgba(232,230,225,0.04)" }}>
      <div className="mono" style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--text-soft)", marginBottom: 7 }}>REPORT A PROBLEM</div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus
        placeholder="What went wrong? (optional) — the debug log is attached automatically"
        style={{ width: "100%", boxSizing: "border-box", resize: "vertical", background: "rgba(0,0,0,0.3)", color: "var(--text)",
          border: "1px solid var(--border)", borderRadius: 8, padding: "7px 9px", fontSize: 12, fontFamily: "inherit" }} />
      {result && <div className="mono" style={{ fontSize: 10.5, marginTop: 6, color: result.ok ? "var(--ok, #3fb984)" : "#e63b2e" }}>{result.text}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={send} disabled={busy}
          style={{ flex: 1, padding: "7px 10px", borderRadius: 8, border: 0, cursor: "pointer", background: "var(--text)", color: "#111013", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em" }}>
          {busy ? "SENDING…" : "SEND TO DEV"}
        </button>
        <button onClick={() => { setOpen(false); setResult(null); }} disabled={busy}
          style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)", cursor: "pointer", background: "transparent", color: "var(--text-soft)", fontSize: 11 }}>
          CANCEL
        </button>
      </div>
    </div>
  );
}
