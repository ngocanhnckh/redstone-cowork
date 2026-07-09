import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { NewAgentSessionSchema, SessionStatePatchSchema, type AgentSession, type SessionStatePatch, type SessionStatus, type UserTodo } from "@rcw/shared";
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
      userTodos: existing?.userTodos ?? [],
      tags: existing?.tags ?? [],
      transcript: [],
      working: existing?.working ?? false,
      contextTokens: existing?.contextTokens ?? null,
      model: existing?.model ?? null,
      tokensInput: existing?.tokensInput ?? 0,
      tokensOutput: existing?.tokensOutput ?? 0,
      tokenSeries: existing?.tokenSeries ?? [],
      pinned: false,
      snoozedUntil: null,
      closedAt: null, // a fresh attach reopens a previously-reaped/dismissed session
      jira: existing?.jira ?? null, // preserve the session's Jira binding across re-attach
    });
    this.bus.emit({ type: "session.updated", payload: { id: session.id } });
    return session;
  }

  async heartbeat(id: string): Promise<boolean> {
    const ok = await this.store.touch(id, new Date());
    if (ok) this.bus.emit({ type: "session.updated", payload: { id } });
    return ok;
  }

  /** Liveness-only touch (no event) — used by the frequent delivery long-poll. */
  async touch(id: string): Promise<void> {
    await this.store.touch(id, new Date());
  }

  private static readonly TOKEN_SERIES_MAX = 80;

  async patchState(id: string, input: unknown): Promise<AgentSession | null> {
    const patch: SessionStatePatch = SessionStatePatchSchema.parse(input);
    // When the hook reports fresh cumulative spend, append a time-series point
    // (bounded) so the client can chart tokens-over-time without extra storage.
    if (patch.tokensOutput !== undefined) {
      const cur = await this.store.get(id);
      if (cur && (patch.tokensOutput !== cur.tokensOutput || (patch.tokensInput ?? cur.tokensInput) !== cur.tokensInput)) {
        const point = { t: new Date(), input: patch.tokensInput ?? cur.tokensInput, output: patch.tokensOutput };
        patch.tokenSeries = [...cur.tokenSeries, point].slice(-SessionsService.TOKEN_SERIES_MAX);
      }
    }
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

  /** Undone items float to the top; each group keeps insertion order (stable). */
  private static sortUserTodos(todos: UserTodo[]): UserTodo[] {
    return [...todos].sort((a, b) => Number(a.done) - Number(b.done));
  }

  async addUserTodo(id: string, text: string): Promise<AgentSession | null> {
    const s = await this.store.get(id);
    if (!s) return null;
    const todo: UserTodo = { id: randomUUID(), text: text.trim(), done: false };
    const updated = await this.store.setUserTodos(id, SessionsService.sortUserTodos([...s.userTodos, todo]));
    if (updated) this.bus.emit({ type: "session.updated", payload: { id } });
    return updated;
  }

  async toggleUserTodo(id: string, todoId: string): Promise<AgentSession | null> {
    const s = await this.store.get(id);
    if (!s) return null;
    const flipped = s.userTodos.map((t) => (t.id === todoId ? { ...t, done: !t.done } : t));
    const updated = await this.store.setUserTodos(id, SessionsService.sortUserTodos(flipped));
    if (updated) this.bus.emit({ type: "session.updated", payload: { id } });
    return updated;
  }

  async deleteUserTodo(id: string, todoId: string): Promise<AgentSession | null> {
    const s = await this.store.get(id);
    if (!s) return null;
    const updated = await this.store.setUserTodos(id, s.userTodos.filter((t) => t.id !== todoId));
    if (updated) this.bus.emit({ type: "session.updated", payload: { id } });
    return updated;
  }

  async addTag(id: string, tag: string): Promise<AgentSession | null> {
    const s = await this.store.get(id);
    if (!s) return null;
    const clean = tag.trim().slice(0, 40);
    if (!clean) return s;
    // Case-insensitive dedupe; keep the first-seen casing.
    if (s.tags.some((t) => t.toLowerCase() === clean.toLowerCase())) return s;
    const updated = await this.store.setTags(id, [...s.tags, clean]);
    if (updated) this.bus.emit({ type: "session.updated", payload: { id } });
    return updated;
  }

  async removeTag(id: string, tag: string): Promise<AgentSession | null> {
    const s = await this.store.get(id);
    if (!s) return null;
    const updated = await this.store.setTags(id, s.tags.filter((t) => t.toLowerCase() !== tag.trim().toLowerCase()));
    if (updated) this.bus.emit({ type: "session.updated", payload: { id } });
    return updated;
  }

  /** Soft-close a session (manual dismiss). Returns false for an unknown id. */
  async dismiss(id: string): Promise<boolean> {
    const s = await this.store.get(id);
    if (!s) return false;
    await this.store.close(id, new Date());
    this.bus.emit({ type: "session.updated", payload: { id } });
    return true;
  }

  get(id: string) { return this.store.get(id); }
  getByWrapper(wrapperId: string) { return this.store.getByWrapper(wrapperId); }
}
