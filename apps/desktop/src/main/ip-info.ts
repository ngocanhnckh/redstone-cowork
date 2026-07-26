// Look up an IP's geolocation + network owner (ASN / org / ISP) online, from the MAIN
// process (no browser CORS). Uses ip-api.com (free, no key, ~45 req/min). Private/reserved
// ranges short-circuit — they have no public geo/owner.

import type { IpInfo } from "../shared/ip";
export type { IpInfo };

function isPrivate(ip: string): boolean {
  if (/^(127\.|10\.|169\.254\.|::1$|fe80:|f[cd])/i.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  const m = ip.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  return false;
}

export async function ipInfo(ip: string): Promise<IpInfo> {
  const q = (ip || "").trim();
  if (!q) return { ip: q, ok: false, error: "no ip" };
  if (isPrivate(q)) return { ip: q, ok: true, private: true };
  const fields = "status,message,country,countryCode,region,regionName,city,lat,lon,timezone,isp,org,as,asname,reverse,mobile,proxy,hosting,query";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(q)}?fields=${fields}`, { signal: ctrl.signal });
    clearTimeout(t);
    const j = (await res.json()) as Record<string, unknown>;
    if (j.status !== "success") return { ip: q, ok: false, error: String(j.message ?? "lookup failed") };
    return {
      ip: q, ok: true,
      city: (j.city as string) || undefined, region: (j.regionName as string) || undefined,
      country: (j.country as string) || undefined, countryCode: (j.countryCode as string) || undefined,
      lat: typeof j.lat === "number" ? j.lat : undefined, lon: typeof j.lon === "number" ? j.lon : undefined,
      timezone: (j.timezone as string) || undefined,
      isp: (j.isp as string) || undefined, org: (j.org as string) || undefined,
      as: (j.as as string) || undefined, asname: (j.asname as string) || undefined,
      reverse: (j.reverse as string) || undefined,
      mobile: !!j.mobile, proxy: !!j.proxy, hosting: !!j.hosting,
    };
  } catch (e) {
    return { ip: q, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
