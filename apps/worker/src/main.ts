import type { NewDomainEvent } from "@rcw/shared";

const API_URL = process.env.API_URL ?? "http://api:3001";
const TOKEN = process.env.INSTANCE_TOKEN ?? "dev-token";
const parsedInterval = Number(process.env.HEARTBEAT_INTERVAL_MS ?? 60000);
const INTERVAL = Number.isFinite(parsedInterval) && parsedInterval >= 1000 ? parsedInterval : 60000;
const parsedSync = Number(process.env.SYNC_INTERVAL_MS ?? 60000);
const SYNC_INTERVAL = Number.isFinite(parsedSync) && parsedSync >= 5000 ? parsedSync : 60000;

const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };

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

// Drive connector ingestion: ask the API to sync every due connection on an interval.
async function syncConnectors() {
  try {
    const res = await fetch(`${API_URL}/connections/sync-due`, { method: "POST", headers: authHeaders });
    if (res.ok) {
      const r = (await res.json()) as { synced: number; inserted: number };
      if (r.synced > 0) console.log(`[worker] sync -> ${r.synced} connection(s), ${r.inserted} new event(s)`);
    } else {
      console.error(`[worker] sync -> ${res.status}`);
    }
  } catch (e) {
    console.error("[worker] sync failed:", (e as Error).message);
  }
}

console.log(`[worker] starting — heartbeat ${INTERVAL}ms, connector sync ${SYNC_INTERVAL}ms`);
beat();
setInterval(beat, INTERVAL);
syncConnectors();
setInterval(syncConnectors, SYNC_INTERVAL);
