import { useEffect, useMemo, useState } from "react";
import type { Weather as Wx } from "../types";

// Weather widget: current conditions + a 3-day outlook for the user's location (derived
// from the public IP via the offline GeoIP DB; forecast from Open-Meteo). Hi-tech card
// with CSS-animated sky icons and a °C/°F toggle. Data via the main-process weather IPC.

type Cat = "clear" | "pcloudy" | "cloudy" | "fog" | "rain" | "snow" | "storm";
function catOf(code: number): Cat {
  if (code === 0) return "clear";
  if (code === 1 || code === 2) return "pcloudy";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "cloudy";
}
const DESC: Record<number, string> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains",
  80: "Light showers", 81: "Showers", 82: "Violent showers", 85: "Snow showers", 86: "Snow showers",
  95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm + hail",
};
const descOf = (c: number) => DESC[c] ?? "—";

const UNIT_KEY = "rcw.weather.unit";
function loadUnit(): "c" | "f" {
  try { return localStorage.getItem(UNIT_KEY) === "f" ? "f" : "c"; } catch { return "c"; }
}
const toF = (c: number) => c * 9 / 5 + 32;

/** A compact CSS-drawn, animated sky icon for a weather category. */
function WxIcon({ cat, day, size = 44 }: { cat: Cat; day: boolean; size?: number }) {
  const showSun = cat === "clear" || cat === "pcloudy";
  const cloud = cat !== "clear";
  return (
    <div className="wx-icon" style={{ width: size, height: size }}>
      {showSun && (day ? <span className="wx-sun" /> : <span className="wx-moon" />)}
      {cloud && <span className={`wx-cloud${cat === "cloudy" || cat === "fog" ? " solo" : ""}`} />}
      {cat === "rain" && <span className="wx-rain"><i /><i /><i /></span>}
      {cat === "snow" && <span className="wx-snow"><i /><i /><i /></span>}
      {cat === "storm" && <span className="wx-bolt" />}
      {cat === "fog" && <span className="wx-fog"><i /><i /><i /></span>}
    </div>
  );
}

export default function Weather() {
  const [wx, setWx] = useState<Wx | null>(null);
  const [unit, setUnit] = useState<"c" | "f">(loadUnit);
  useEffect(() => { try { localStorage.setItem(UNIT_KEY, unit); } catch { /* ignore */ } }, [unit]);

  useEffect(() => {
    let alive = true;
    const load = () => { window.cowork.weather().then((w) => { if (alive) setWx(w); }).catch(() => { if (alive) setWx({ ok: false, city: null, country: null, current: null, daily: [] }); }); };
    load();
    const id = setInterval(load, 15 * 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const t = useMemo(() => (n: number | undefined) => (n == null ? "—" : `${Math.round(unit === "f" ? toF(n) : n)}°`), [unit]);
  const cur = wx?.current ?? null;
  const cat = cur ? catOf(cur.code) : "cloudy";

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
      <WxStyles />
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 9.5, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-soft)" }}>Weather</span>
        <span className="mono faint" style={{ fontSize: 9.5, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{wx?.city ? [wx.city, wx.country].filter(Boolean).join(", ") : ""}</span>
        <span style={{ flex: 1 }} />
        <div style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden" }}>
          {(["c", "f"] as const).map((u) => (
            <button key={u} onClick={() => setUnit(u)} style={{ border: "none", cursor: "pointer", padding: "1px 6px", fontSize: 9, fontFamily: "var(--font-mono)", background: unit === u ? "rgb(var(--primary) / 0.26)" : "transparent", color: unit === u ? "var(--text)" : "var(--text-soft)" }}>°{u.toUpperCase()}</button>
          ))}
        </div>
      </div>

      {!wx ? (
        <div className="mono faint" style={{ fontSize: 11, margin: "auto" }}>reading skies…</div>
      ) : !wx.ok || !cur ? (
        <div className="mono faint" style={{ fontSize: 10.5, margin: "auto", textAlign: "center", lineHeight: 1.5 }}>weather unavailable<br />(needs internet + geo DB)</div>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <WxIcon cat={cat} day={cur.isDay} />
            <div style={{ minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
                <span style={{ fontSize: 34, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", lineHeight: 1, textShadow: "0 0 16px rgb(var(--primary-soft) / 0.5)" }}>{t(cur.tempC)}</span>
              </div>
              <div className="mono" style={{ fontSize: 10.5, color: "var(--text-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{descOf(cur.code)}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, marginTop: 7, flexShrink: 0 }}>
            <Stat label="Feels" value={t(cur.feelsC)} />
            <Stat label="Wind" value={`${Math.round(cur.windKmh)}`} unit="km/h" />
            <Stat label="Humid" value={`${Math.round(cur.humidity)}`} unit="%" />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: "auto", paddingTop: 8, borderTop: "1px solid var(--border)" }}>
            {wx.daily.slice(1, 4).map((d) => {
              const dc = catOf(d.code);
              return (
                <div key={d.date} title={descOf(d.code)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, minWidth: 0 }}>
                  <span className="mono faint" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em" }}>{new Date(d.date).toLocaleDateString(undefined, { weekday: "short" })}</span>
                  <WxIcon cat={dc} day size={26} />
                  <span className="mono" style={{ fontSize: 9.5 }}><span style={{ color: "var(--text)" }}>{t(d.maxC)}</span> <span className="faint">{t(d.minC)}</span></span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="mono faint" style={{ fontSize: 8.5, letterSpacing: "0.1em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 13, fontFamily: "var(--font-mono)" }}>{value}<span className="faint" style={{ fontSize: 8.5 }}>{unit ? ` ${unit}` : ""}</span></div>
    </div>
  );
}

function WxStyles() {
  return (
    <style>{`
      .wx-icon { position: relative; flex-shrink: 0; }
      @keyframes wx-spin { to { transform: rotate(360deg); } }
      @keyframes wx-pulse { 0%,100% { transform: scale(1); } 50% { transform: scale(1.06); } }
      @keyframes wx-drift { 0%,100% { transform: translateX(-2px); } 50% { transform: translateX(2px); } }
      @keyframes wx-fall { 0% { transform: translateY(-6px); opacity: 0; } 30% { opacity: 1; } 100% { transform: translateY(14px); opacity: 0; } }
      @keyframes wx-flash { 0%,92%,100% { opacity: .55; filter: none; } 94%,98% { opacity: 1; filter: drop-shadow(0 0 6px #ffe08a); } }
      .wx-sun { position: absolute; left: 6px; top: 6px; width: 22px; height: 22px; border-radius: 50%;
        background: radial-gradient(circle at 40% 38%, #ffe9a8, #ffb454); box-shadow: 0 0 16px 3px rgb(255 180 84 / 0.7); animation: wx-pulse 3s ease-in-out infinite; }
      .wx-sun::before { content: ""; position: absolute; inset: -8px; border-radius: 50%;
        background: repeating-conic-gradient(rgb(255 190 84 / 0.6) 0deg 3deg, transparent 3deg 30deg);
        -webkit-mask: radial-gradient(circle, transparent 15px, #000 16px, #000 18px, transparent 19px);
        mask: radial-gradient(circle, transparent 15px, #000 16px, #000 18px, transparent 19px); animation: wx-spin 14s linear infinite; }
      .wx-moon { position: absolute; left: 8px; top: 6px; width: 22px; height: 22px; border-radius: 50%;
        background: #dfeaf2; box-shadow: inset -7px -3px 0 0 rgb(30 40 55), 0 0 14px 2px rgb(150 190 230 / 0.5); animation: wx-pulse 4s ease-in-out infinite; }
      .wx-cloud { position: absolute; right: 3px; bottom: 8px; width: 26px; height: 12px; border-radius: 10px;
        background: linear-gradient(180deg, #cdd6de, #9aa7b3); box-shadow: 0 0 12px rgb(150 170 190 / 0.4); animation: wx-drift 5s ease-in-out infinite; }
      .wx-cloud::before { content: ""; position: absolute; top: -7px; left: 5px; width: 13px; height: 13px; border-radius: 50%; background: #cdd6de; }
      .wx-cloud::after { content: ""; position: absolute; top: -4px; left: 13px; width: 10px; height: 10px; border-radius: 50%; background: #b8c2cc; }
      .wx-cloud.solo { left: 50%; right: auto; top: 50%; transform: translate(-50%,-50%); }
      .wx-rain, .wx-snow, .wx-fog { position: absolute; left: 10px; bottom: 0; width: 24px; height: 14px; }
      .wx-rain i { position: absolute; top: 0; width: 2px; height: 7px; border-radius: 2px; background: rgb(120 200 255 / 0.9); box-shadow: 0 0 5px rgb(84 230 255 / 0.7); animation: wx-fall .9s linear infinite; }
      .wx-rain i:nth-child(1) { left: 2px; animation-delay: 0s; } .wx-rain i:nth-child(2) { left: 10px; animation-delay: .3s; } .wx-rain i:nth-child(3) { left: 18px; animation-delay: .6s; }
      .wx-snow i { position: absolute; top: 0; width: 4px; height: 4px; border-radius: 50%; background: #eaf4ff; box-shadow: 0 0 5px rgb(200 230 255 / 0.8); animation: wx-fall 1.6s linear infinite; }
      .wx-snow i:nth-child(1) { left: 2px; animation-delay: 0s; } .wx-snow i:nth-child(2) { left: 10px; animation-delay: .5s; } .wx-snow i:nth-child(3) { left: 18px; animation-delay: 1s; }
      .wx-bolt { position: absolute; left: 16px; bottom: 1px; width: 12px; height: 16px; background: #ffe08a;
        clip-path: polygon(55% 0, 15% 55%, 45% 55%, 30% 100%, 85% 40%, 52% 40%); box-shadow: 0 0 8px #ffcf5a; animation: wx-flash 3s ease-in-out infinite; }
      .wx-fog i { position: absolute; height: 2.5px; border-radius: 2px; background: rgb(180 200 220 / 0.55); animation: wx-drift 4s ease-in-out infinite; }
      .wx-fog i:nth-child(1) { top: 2px; left: 0; width: 24px; } .wx-fog i:nth-child(2) { top: 7px; left: 3px; width: 20px; animation-delay: .6s; } .wx-fog i:nth-child(3) { top: 12px; left: 1px; width: 22px; animation-delay: 1.2s; }
      body.rcw-hidden .wx-sun, body.rcw-hidden .wx-sun::before, body.rcw-hidden .wx-moon, body.rcw-hidden .wx-cloud,
      body.rcw-hidden .wx-rain i, body.rcw-hidden .wx-snow i, body.rcw-hidden .wx-bolt, body.rcw-hidden .wx-fog i { animation-play-state: paused !important; }
    `}</style>
  );
}
