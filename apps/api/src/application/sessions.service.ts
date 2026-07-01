import { Inject, Injectable } from "@nestjs/common";
import { NewAgentSessionSchema, SessionStatePatchSchema, type AgentSession, type SessionStatePatch, type SessionStatus } from "@rcw/shared";
import { SESSION_STORE, type SessionStore } from "../domain/sessions/session-store.port";
import { EventsBus } from "./events-bus";

export type SessionView = AgentSession & { status: SessionStatus; pendingDecisions: number; waitingSince: Date | null };

const ACTIVE_MS = 90_000;
const STALE_MS = 300_000;

export const sessionStatus = (s: AgentSession, pending: number, now: Date): SessionStatus => {
  const age = now.getTime() - s.lastSeenAt.getTime();
  // A session silent past the stale window is dead (its tmux/poller is gone) even
  // if it still holds pending decision cards — those can't be delivered anymore,
  // so it must not linger as "waiting"/online. The live poller heartbeats every
  // ~25s, so a genuinely-waiting (alive) session never reaches this.
  if (age >= STALE_MS) return "lost";
  if (pending > 0) return "waiting";
  if (age < ACTIVE_MS) return "active";
  return "stale";
};

@Injectable()
export class SessionsService {
  constructor(
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    private readonly bus: EventsBus,
  ) {}

  async attach(input: unknown): Promise<AgentSession> {
    const parsed = NewAgentSessionSchema.parse(input);
    const now = new Date();
    // Latch auto-capability: once a session is launched with --enable-auto-mode or is
    // ever observed in auto mode, keep autoModeEnabled true across re-attaches (--resume).
    const existing = await this.store.get(parsed.id);
    const autoModeEnabled =
      (existing?.autoModeEnabled ?? false) ||
      (parsed.autoModeEnabled ?? false) ||
      parsed.permissionMode === "auto";
    const session = await this.store.upsert({
      ...parsed,
      attachedAt: now,
      lastSeenAt: now,
      permissionMode: parsed.permissionMode ?? null,
      autoModeEnabled,
      latestAnswer: null,
      summary: null,
      todos: [],
      transcript: [],
      working: existing?.working ?? false,
      pinned: false,
      snoozedUntil: null,
    });
    this.bus.emit({ type: "session.updated", payload: { id: session.id } });
    return session;
  }

  async heartbeat(id: string): Promise<boolean> {
    const ok = await this.store.touch(id, new Date());
    if (ok) this.bus.emit({ type: "session.updated", payload: { id } });
    return ok;
  }

  async patchState(id: string, input: unknown): Promise<AgentSession | null> {
    const patch: SessionStatePatch = SessionStatePatchSchema.parse(input);
    const updated = await this.store.patchState(id, patch);
    if (updated) this.bus.emit({ type: "session.updated", payload: { id } });
    return updated;
  }

  async snooze(id: string, minutes: number, now = new Date()): Promise<void> {
    const until = new Date(now.getTime() + Math.max(0, minutes) * 60_000);
    await this.store.setSnoozedUntil(id, until);
    this.bus.emit({ type: "session.updated", payload: { id } });
  }

  async pin(id: string, pinned: boolean): Promise<void> {
    await this.store.setPinned(id, pinned);
    this.bus.emit({ type: "session.updated", payload: { id } });
  }

  private toView(s: AgentSession, pending: number, oldestPendingAt: Record<string, Date>, now: Date): SessionView {
    return {
      ...s,
      pendingDecisions: pending,
      status: sessionStatus(s, pending, now),
      waitingSince: oldestPendingAt[s.id] ?? null,
    };
  }

  async listViews(pendingBySession: Record<string, number>, oldestPendingAt: Record<string, Date>): Promise<SessionView[]> {
    const now = new Date();
    return (await this.store.list()).map((s) => this.toView(s, pendingBySession[s.id] ?? 0, oldestPendingAt, now));
  }

  async queue(pendingBySession: Record<string, number>, oldestPendingAt: Record<string, Date>, now = new Date()): Promise<SessionView[]> {
    const views = (await this.store.list())
      .map((s) => this.toView(s, pendingBySession[s.id] ?? 0, oldestPendingAt, now))
      .filter((v) => v.status === "waiting")
      .filter((v) => !v.snoozedUntil || v.snoozedUntil.getTime() <= now.getTime());
    return views.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const aw = a.waitingSince?.getTime() ?? 0;
      const bw = b.waitingSince?.getTime() ?? 0;
      return aw - bw;
    });
  }

  get(id: string) { return this.store.get(id); }
  getByWrapper(wrapperId: string) { return this.store.getByWrapper(wrapperId); }
}
