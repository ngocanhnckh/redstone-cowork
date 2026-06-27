import ConnectionBar from "./ConnectionBar";

export default function TerminalPanel({ machine }: { machine: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <ConnectionBar machine={machine} />
      <div style={{ flex: 1, overflowY: "auto", padding: "18px 32px 24px" }} className="no-scrollbar">
        <div
          className="glass-inset"
          style={{ padding: "20px 22px", borderRadius: 16, maxWidth: 520 }}
        >
          <h3
            className="display"
            style={{ fontSize: 22, fontWeight: 400, margin: "0 0 6px", lineHeight: 1.1 }}
          >
            Terminal
          </h3>
          <p className="faint" style={{ fontSize: 12.5, lineHeight: 1.55, margin: 0 }}>
            The live shell arrives in the next increment.
          </p>
        </div>
      </div>
    </div>
  );
}
