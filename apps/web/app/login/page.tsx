"use client";
import { useEffect, useState } from "react";

type Mode = "account" | "token" | "redstone";

export default function Login() {
  const [mode, setMode] = useState<Mode>("account");
  const [redstoneOn, setRedstoneOn] = useState(false);
  const [accountsOn, setAccountsOn] = useState(false);
  const [jiraOn, setJiraOn] = useState(false);
  const [orgName, setOrgName] = useState<string | null>(null);
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/auth/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c) => {
        if (!c) return;
        setRedstoneOn(!!c.redstone);
        setAccountsOn(!!c.accounts);
        setJiraOn(!!c.jira);
        setOrgName(c.orgName ?? null);
        setMode(c.accounts ? "account" : c.redstone ? "redstone" : "token");
      })
      .catch(() => {});
  }, []);

  async function submit(path: string, body: Record<string, string>) {
    setError(""); setBusy(true);
    try {
      const r = await fetch(path, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, cache: "no-store" });
      if (r.ok) return void (window.location.href = "/admin");
      const j = await r.json().catch(() => ({}));
      setError(j.error ?? j.error_description ?? (r.status === 401 ? "Credentials rejected." : `Sign-in failed (HTTP ${r.status}).`));
    } catch { setError("Couldn't reach the server."); }
    finally { setBusy(false); }
  }

  const go = () => {
    if (mode === "account") return submit("/api/login/account", { username: username.trim(), password });
    if (mode === "redstone") return submit("/api/login/redstone", { username: username.trim(), password });
    return submit("/api/login", { token: token.trim() });
  };

  return (
    <main className="yia">
      <style>{CSS}</style>
      <div className="yia-grid" />
      <div className="yia-card">
        <div style={{ textAlign: "center" }}>
          <div className="yia-seal">◈</div>
          <div className="yia-kick">{(orgName ?? "YITEC INTELLIGENCE AGENCY").toUpperCase()}</div>
          <div className="yia-title">SECURE ACCESS TERMINAL</div>
          <div className="yia-sub">REDSTONE COWORK · CLEARANCE REQUIRED</div>
        </div>

        <div style={{ marginTop: 26 }}>
          {mode === "token" ? (
            <>
              <label className="yia-label">INSTANCE TOKEN</label>
              <input className="yia-input" type="password" value={token} onChange={(e) => setToken(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && go()} placeholder="INSTANCE_TOKEN" autoComplete="off" spellCheck={false} />
            </>
          ) : (
            <>
              <label className="yia-label">{mode === "account" ? "AGENT ID" : "REDSTONE USERNAME"}</label>
              <input className="yia-input" value={username} onChange={(e) => setUsername(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && go()} placeholder={mode === "account" ? "firstname.lastname" : "you@yourorg"}
                autoCapitalize="off" autoCorrect="off" spellCheck={false} />
              <label className="yia-label" style={{ marginTop: 13 }}>ACCESS CODE</label>
              <input className="yia-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && go()} placeholder="••••••••••••" autoComplete="current-password" />
            </>
          )}
          <button className="yia-btn" onClick={go} disabled={busy}>{busy ? "AUTHENTICATING…" : "REQUEST ACCESS"}</button>

          {jiraOn && mode === "account" && (
            <>
              <div className="yia-or">OR</div>
              <a className="yia-jira" href="/api/login/jira/start">
                <svg width="15" height="15" viewBox="0 0 32 32" fill="currentColor" aria-hidden><path d="M16.4 2 6 12.4a1.4 1.4 0 0 0 0 2l10.4 10.4 4-4-8.4-8.4 4-4a1.4 1.4 0 0 0 0-2L16.4 2z"/><path opacity=".7" d="M25.6 11.2 20 16.8l-4 4 5.6 5.6a1.4 1.4 0 0 0 2 0l6-6a1.4 1.4 0 0 0 0-2l-4-7.2z"/></svg>
                SIGN IN WITH JIRA
              </a>
            </>
          )}
          {error && <p className="yia-err">⚠ {error}</p>}
        </div>

        <div className="yia-alts">
          {accountsOn && mode !== "account" && <button onClick={() => { setMode("account"); setError(""); }}>AGENT LOGIN</button>}
          {redstoneOn && mode !== "redstone" && <button onClick={() => { setMode("redstone"); setError(""); }}>REDSTONE SSO</button>}
          {mode !== "token" && <button onClick={() => { setMode("token"); setError(""); }}>INSTANCE TOKEN</button>}
        </div>
      </div>
    </main>
  );
}

const CSS = `
.yia { min-height:100vh; display:flex; align-items:center; justify-content:center; position:relative; overflow:hidden; padding:24px;
  background: radial-gradient(ellipse 120% 90% at 50% 0%, #0a1620 0%, #050a10 55%, #030608 100%); font-family:"SF Mono",ui-monospace,monospace; }
.yia-grid { position:absolute; inset:0; opacity:.15; pointer-events:none;
  background-image: linear-gradient(rgb(84 230 255 / .25) 1px, transparent 1px), linear-gradient(90deg, rgb(84 230 255 / .25) 1px, transparent 1px);
  background-size: 44px 44px; -webkit-mask-image: radial-gradient(ellipse 85% 70% at 50% 45%, #000 30%, transparent 75%); mask-image: radial-gradient(ellipse 85% 70% at 50% 45%, #000 30%, transparent 75%); }
.yia-card { position:relative; z-index:2; width:440px; max-width:94vw; padding:36px 38px; border-radius:16px;
  border:1px solid rgb(84 230 255 / .3); background: rgb(8 14 20 / .74); backdrop-filter: blur(24px) saturate(1.3);
  box-shadow: 0 0 60px -18px rgb(84 230 255 / .5), inset 0 0 40px -30px rgb(84 230 255 / .6); }
.yia-seal { width:74px; height:74px; margin:0 auto 14px; border-radius:50%; border:2px solid rgb(84 230 255 / .8);
  display:flex; align-items:center; justify-content:center; font-size:34px; color:#54e6ff; box-shadow:0 0 26px -4px #54e6ff; }
.yia-kick { font-size:10px; letter-spacing:.4em; color: rgb(84 230 255 / .85); }
.yia-title { font-size:20px; font-weight:700; letter-spacing:.14em; color:#e6f2f4; margin:7px 0 2px; }
.yia-sub { font-size:10px; letter-spacing:.2em; color: rgb(230 242 244 / .45); }
.yia-label { display:block; font-size:9.5px; letter-spacing:.3em; color: rgb(84 230 255 / .75); margin:0 0 6px 2px; }
.yia-input { width:100%; box-sizing:border-box; padding:11px 14px; border-radius:8px; font-size:14px; font-family:inherit;
  border:1px solid rgb(84 230 255 / .3); background: rgb(84 230 255 / .05); color:#e6f2f4; outline:none; }
.yia-input:focus { border-color: rgb(84 230 255 / .8); box-shadow: 0 0 0 1px rgb(84 230 255 / .35); }
.yia-btn { width:100%; margin-top:20px; padding:13px 0; border-radius:9px; border:1px solid rgb(84 230 255 / .7); cursor:pointer;
  background: linear-gradient(180deg, rgb(84 230 255 / .22), rgb(84 230 255 / .1)); color:#d9f7ff; font-family:inherit;
  font-size:13px; font-weight:700; letter-spacing:.3em; text-shadow:0 0 12px rgb(84 230 255 / .8); }
.yia-btn:hover:not(:disabled) { box-shadow:0 0 30px -6px rgb(84 230 255 / .8); }
.yia-btn:disabled { opacity:.4; cursor:not-allowed; }
.yia-or { display:flex; align-items:center; gap:10px; margin:14px 0 2px; color: rgb(230 242 244 / .3); font-size:9px; letter-spacing:.3em; }
.yia-or::before, .yia-or::after { content:""; flex:1; height:1px; background: rgb(84 230 255 / .18); }
.yia-jira { width:100%; box-sizing:border-box; margin-top:10px; padding:11px 0; border-radius:9px; border:1px solid rgb(38 132 255 / .6);
  background: linear-gradient(180deg, rgb(38 132 255 / .22), rgb(38 132 255 / .1)); color:#cfe4ff; text-decoration:none;
  font-size:12px; font-weight:700; letter-spacing:.22em; display:flex; align-items:center; justify-content:center; gap:9px; }
.yia-jira:hover { box-shadow:0 0 28px -6px rgb(38 132 255 / .85); }
.yia-err { color:#ff7d72; font-size:11.5px; margin-top:12px; }
.yia-alts { display:flex; justify-content:center; gap:6px; margin-top:18px; flex-wrap:wrap; }
.yia-alts button { background:none; border:none; color: rgb(230 242 244 / .4); font-family:inherit; font-size:10px; letter-spacing:.18em; cursor:pointer; padding:4px 8px; }
.yia-alts button:hover { color: rgb(84 230 255 / .85); }
`;
