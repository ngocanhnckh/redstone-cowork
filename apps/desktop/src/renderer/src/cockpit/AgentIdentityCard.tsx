import { useEffect, useState } from "react";

// Futuristic identity card for the signed-in agent, shown at the top of the right
// sidebar: "SPECIAL AGENT <name>", rank (profile level), and photo. Pulls from the
// account profile (accountsMe), falling back to the device-trust record.

type Ident = { name: string; rank: string; photo: string | null };

const CSS = `
@keyframes aic-sheen { from { background-position: -140% 0; } to { background-position: 240% 0; } }
.aic { position:relative; overflow:hidden; margin:0 0 12px; padding:12px 13px; border-radius:13px;
  border:1px solid rgb(84 230 255 / .3); background: color-mix(in srgb, var(--app-panel) 90%, transparent);
  -webkit-backdrop-filter: blur(20px) saturate(1.3); backdrop-filter: blur(20px) saturate(1.3);
  box-shadow: 0 10px 30px -12px rgb(0 0 0 / .6), inset 0 0 30px -22px rgb(84 230 255 / .9);
  display:flex; align-items:center; gap:12px; font-family:var(--font-mono); }
.aic::before { content:""; position:absolute; inset:0; pointer-events:none; opacity:.5;
  background: linear-gradient(115deg, transparent 34%, rgb(84 230 255 / .12) 50%, transparent 66%);
  background-size: 220% 100%; animation: aic-sheen 4.4s ease-in-out infinite; }
.aic-photo { width:52px; height:52px; border-radius:50%; object-fit:cover; flex-shrink:0;
  border:2px solid rgb(84 230 255 / .55); box-shadow: 0 0 16px -3px rgb(84 230 255 / .7); background:#05090d; }
.aic-photo.ph { display:flex; align-items:center; justify-content:center; font-size:22px; color: rgb(84 230 255 / .55); }
.aic-kick { font-size:8.5px; letter-spacing:.34em; color: rgb(84 230 255 / .85); font-weight:700; }
.aic-name { font-size:14.5px; font-weight:700; letter-spacing:.05em; color:#e6f2f4; line-height:1.15; margin-top:2px; }
.aic-rank { display:inline-flex; align-items:center; gap:5px; margin-top:5px; font-size:9px; letter-spacing:.2em;
  padding:2px 8px; border-radius:999px; border:1px solid rgb(224 162 74 / .5); color:#e0a24a; }
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
          const acct = me as { displayName: string; username: string; level?: string; role: string; photo?: string | null };
          setId({
            name: acct.displayName || acct.username,
            rank: acct.level || (acct.role === "admin" ? "DIRECTOR" : "FIELD AGENT"),
            photo: acct.photo ?? null,
          });
          return;
        }
      } catch { /* not an account session — fall through */ }
      // Fallback: device-trust identity (paired agent on this machine).
      try {
        const t = await window.cowork.deviceTrust();
        if (!cancelled && t) setId({ name: t.displayName || t.username, rank: "FIELD AGENT", photo: t.photo });
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!id) return null;

  return (
    <div className="aic">
      <style>{CSS}</style>
      {id.photo ? <img className="aic-photo" src={id.photo} alt={id.name} /> : <div className="aic-photo ph">◍</div>}
      <div style={{ minWidth: 0 }}>
        <div className="aic-kick">SPECIAL AGENT</div>
        <div className="aic-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{id.name}</div>
        <span className="aic-rank">★ {id.rank.toUpperCase()}</span>
      </div>
    </div>
  );
}
