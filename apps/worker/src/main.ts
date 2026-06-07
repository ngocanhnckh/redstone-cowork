import type { NewDomainEvent } from "@rcw/shared";

const API_URL = process.env.API_URL ?? "http://api:3001";
const TOKEN = process.env.INSTANCE_TOKEN ?? "dev-token";
const parsedInterval = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 60000);
const INTERVAL = Number.isFinite(parsedInterval) && parsedInterval >= 1000 ? parsedInterval : 60000;

async function beat() {
  const event: NewDomainEvent = {
    type: "worker.heartbeat",
    source: "worker",
    payload: { hostname: process.env.HOSTNAME ?? "unknown" },
  };
  try {
    const res = await fetch(`${API_URL}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify(event),
    });
    console.log(`[worker] heartbeat -> ${res.status}`);
  } catch (e) {
    console.error("[worker] heartbeat failed:", (e as Error).message);
  }
}

console.log(`[worker] starting, beating every ${INTERVAL}ms`);
beat();
setInterval(beat, INTERVAL);
