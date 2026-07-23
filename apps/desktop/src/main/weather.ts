import { geoLookup } from "./geoip";

// Weather for the user's location, for the Weather widget. Location is derived from the
// machine's public IP via the bundled OFFLINE GeoIP DB (no browser location prompt);
// the forecast comes from Open-Meteo (https://open-meteo.com) — free, no API key, and
// no personal data sent beyond a coarse lat/lon. Best-effort; cached ~15 min.

export type WeatherCurrent = { tempC: number; feelsC: number; code: number; windKmh: number; humidity: number; isDay: boolean };
export type WeatherDay = { date: string; maxC: number; minC: number; code: number };
export type Weather = { ok: boolean; city: string | null; country: string | null; current: WeatherCurrent | null; daily: WeatherDay[] };

const FAIL: Weather = { ok: false, city: null, country: null, current: null, daily: [] };

async function fetchJson(url: string, ms: number): Promise<any | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
  finally { clearTimeout(t); }
}

async function fetchText(url: string, ms: number): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return (await res.text()).trim();
  } catch { return null; }
  finally { clearTimeout(t); }
}

let cache: { at: number; w: Weather } | null = null;
const TTL_MS = 15 * 60_000;

export async function getWeather(): Promise<Weather> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.w;
  try {
    // 1. Public IP → offline geolocation (never leaves us except the "what's my IP" ask).
    const ip = await fetchText("https://api.ipify.org", 5000);
    if (!ip || !/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return FAIL;
    const geo = await geoLookup(ip);
    if (!geo) return FAIL;
    // 2. Forecast from Open-Meteo for that lat/lon.
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}`
      + `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day`
      + `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4`;
    const j = await fetchJson(url, 6000);
    if (!j || !j.current) return FAIL;
    const c = j.current, d = j.daily ?? {};
    const daily: WeatherDay[] = Array.isArray(d.time)
      ? d.time.map((date: string, i: number) => ({ date, maxC: d.temperature_2m_max?.[i], minC: d.temperature_2m_min?.[i], code: d.weather_code?.[i] }))
      : [];
    const w: Weather = {
      ok: true, city: geo.city, country: geo.country,
      current: {
        tempC: c.temperature_2m, feelsC: c.apparent_temperature, code: c.weather_code,
        windKmh: c.wind_speed_10m, humidity: c.relative_humidity_2m, isDay: c.is_day === 1,
      },
      daily,
    };
    cache = { at: Date.now(), w };
    return w;
  } catch {
    return FAIL;
  }
}
