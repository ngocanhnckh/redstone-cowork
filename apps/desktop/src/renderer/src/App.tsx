export default function App() {
  return (
    <div data-app className="grain" style={{ minHeight: "100vh" }}>
      <div className="atmosphere">
        <div className="blob blob--a" />
        <div className="blob blob--b" />
        <div className="blob blob--c" />
      </div>
      <main style={{ position: "relative", zIndex: 2, padding: "56px 48px" }}>
        <span className="kicker">Redstone Cowork · Desktop</span>
        <h1 className="display" style={{ fontSize: 64, margin: "10px 0 0" }}>
          Focus <span className="display italic" style={{ color: "rgb(var(--primary-soft))" }}>Theater</span>
        </h1>
        <p className="soft" style={{ maxWidth: 460, marginTop: 14, lineHeight: 1.55 }}>
          One calm surface for every coding-agent session. Login and the live waiting queue land here next.
        </p>
      </main>
    </div>
  );
}
