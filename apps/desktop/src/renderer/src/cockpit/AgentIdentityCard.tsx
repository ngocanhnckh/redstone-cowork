import { useEffect, useState } from "react";

// Futuristic identity card for the signed-in agent, shown at the top of the right
// sidebar: "SPECIAL AGENT <name>", rank (profile level), and photo. Pulls from the
// account profile (accountsMe), falling back to the device-trust record.

type Ident = { name: string; username: string; rank: string; division: string; photo: string | null };

const CSS = `
@keyframes aic-sheen { from { background-position: -140% 0; } to { background-position: 240% 0; } }
@keyframes aic-corner { 0%,100% { opacity:.5; } 50% { opacity:1; } }
.aic { position:relative; overflow:hidden; margin:0 0 14px; padding:14px 14px 13px; border-radius:14px;
  border:1px solid rgb(84 230 255 / .3); background: color-mix(in srgb, var(--app-panel) 90%, transparent);
  -webkit-backdrop-filter: blur(20px) saturate(1.3); backdrop-filter: blur(20px) saturate(1.3);
  box-shadow: 0 12px 34px -12px rgb(0 0 0 / .65), inset 0 0 34px -22px rgb(84 230 255 / .9);
  display:flex; flex-direction:column; align-items:center; font-family:var(--font-mono); }
.aic::before { content:""; position:absolute; inset:0; pointer-events:none; opacity:.5;
  background: linear-gradient(115deg, transparent 34%, rgb(84 230 255 / .12) 50%, transparent 66%);
  background-size: 220% 100%; animation: aic-sheen 4.4s ease-in-out infinite; }
.aic-frame { position:relative; width:100%; aspect-ratio:1/1; border-radius:11px; overflow:hidden;
  border:1px solid rgb(84 230 255 / .5); box-shadow: 0 0 22px -6px rgb(84 230 255 / .7), inset 0 0 30px -20px rgb(84 230 255); background:#05090d; }
.aic-photo { width:100%; height:100%; object-fit:cover; display:block; }
.aic-photo.ph { display:flex; align-items:center; justify-content:center; font-size:64px; color: rgb(84 230 255 / .4); }
.aic-corner { position:absolute; width:14px; height:14px; border-color:#54e6ff; border-style:solid; animation: aic-corner 2.2s ease-in-out infinite; }
.aic-kick { font-size:9px; letter-spacing:.36em; color: rgb(84 230 255 / .85); font-weight:700; margin-top:12px; }
.aic-name { font-size:16px; font-weight:700; letter-spacing:.05em; color:#e6f2f4; line-height:1.15; margin-top:3px; text-align:center; }
.aic-user { font-size:10px; letter-spacing:.14em; color: var(--text-faint); margin-top:2px; }
.aic-badges { display:flex; gap:6px; margin-top:9px; flex-wrap:wrap; justify-content:center; }
.aic-rank { display:inline-flex; align-items:center; gap:5px; font-size:9px; letter-spacing:.2em;
  padding:3px 9px; border-radius:999px; border:1px solid rgb(224 162 74 / .5); color:#e0a24a; }
`;

export default function AgentIdentityCard() {
  const [id, setId] = useState<Ident | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await window.cowork.accountsMe();
        if (cancelled) return;
        if (me && "username" in me && me.username) {
          const acct = me as { displayName: string; username: string; level?: string; division?: string; role: string; photo?: string | null };
          setId({
            name: acct.displayName || acct.username,
            username: acct.username,
            rank: acct.level || (acct.role === "admin" ? "DIRECTOR" : "FIELD AGENT"),
            division: acct.division ?? "",
            photo: acct.photo ?? null,
          });
          return;
        }
      } catch { /* not an account session — fall through */ }
      // Fallback: device-trust identity (paired agent on this machine).
      try {
        const t = await window.cowork.deviceTrust();
        if (!cancelled && t) setId({ name: t.displayName || t.username, username: t.username, rank: "FIELD AGENT", division: "", photo: t.photo });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!id) return null;

  return (
    <div className="aic">
      <style>{CSS}</style>
      <div className="aic-frame">
        {id.photo ? <img className="aic-photo" src={id.photo} alt={id.name} /> : <div className="aic-photo ph">◍</div>}
        <span className="aic-corner" style={{ top: 5, left: 5, borderWidth: "2px 0 0 2px" }} />
        <span className="aic-corner" style={{ top: 5, right: 5, borderWidth: "2px 2px 0 0" }} />
        <span className="aic-corner" style={{ bottom: 5, left: 5, borderWidth: "0 0 2px 2px" }} />
        <span className="aic-corner" style={{ bottom: 5, right: 5, borderWidth: "0 2px 2px 0" }} />
      </div>
      <div className="aic-kick">SPECIAL AGENT</div>
      <div className="aic-name">{id.name}</div>
      {id.username && <div className="aic-user">@{id.username}</div>}
      <div className="aic-badges">
        <span className="aic-rank">★ {id.rank.toUpperCase()}</span>
        {id.division && <span className="aic-rank" style={{ borderColor: "rgb(84 230 255 / .5)", color: "rgb(84 230 255 / .95)" }}>◈ {id.division.toUpperCase()}</span>}
      </div>
    </div>
  );
}
