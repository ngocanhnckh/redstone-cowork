const API_URL = process.env.API_INTERNAL_URL ?? "http://api:3001";
const TOKEN = process.env.INSTANCE_TOKEN ?? "dev-token";

export const dynamic = "force-dynamic";

async function getStatus() {
  try {
    const health = await fetch(`${API_URL}/health`, { cache: "no-store" }).then((r) => r.json());
    const events = await fetch(`${API_URL}/events`, {
      headers: { Authorization: `Bearer ${TOKEN}` }, cache: "no-store",
    }).then((r) => (r.ok ? r.json() : []));
    return { health, eventCount: events.length, latest: events[0] ?? null };
  } catch {
    return { health: { status: "unreachable" }, eventCount: 0, latest: null };
  }
}

export default async function Home() {
  const s = await getStatus();
  return (
    <main>
      <h1>Redstone Cowork</h1>
      <p>API: <strong>{s.health.status}</strong></p>
      <p>Domain events recorded: <strong>{s.eventCount}</strong></p>
      {s.latest && <pre style={{ background: "#131a2e", padding: "1rem", borderRadius: 8 }}>{JSON.stringify(s.latest, null, 2)}</pre>}
    </main>
  );
}
