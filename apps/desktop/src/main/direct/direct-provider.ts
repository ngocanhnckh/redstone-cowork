import { buildDecisionSpec } from "@rcw/claude-core";
import { ProbeChannel } from "./probe-channel";
import { SessionEngine, type DirectSession } from "./session-engine";
import { enabledHosts, recordStatus, sshTargetOf, type HostEntry } from "./host-book";
import { flushNow, intentFor, isResolved, markResolved, prune, updateIntent } from "./store";
import type { ProviderEvent, Resolution, SessionProvider } from "../providers/provider";
import type { ServerHost } from "../workspace";

// ---------------------------------------------------------------------------
// The direct (agent-free) backend.
//
// Implements the same SessionProvider surface the cowork server does, so the renderer
// and all ~230 IPC channels are unchanged — the cockpit cannot tell which backend it
// is talking to.
//
// Read paths are complete. Anything that types into Claude (instruct, interrupt,
// resolve, mode) needs tmux delivery and lands in the next phase; those reject with a
// clear message rather than silently doing nothing, because a control that appears to
// work and doesn't is worse than one that says it can't yet.
// ---------------------------------------------------------------------------

const REFRESH_MS = 4_000;

type HostRuntime = { host: HostEntry; channel: ProbeChannel; engine: SessionEngine };

/** A decision card derived from a blocked session, matching the hosted shape exactly. */
export type DirectDecision = {
  id: string;
  sessionId: string;
  kind: "permission" | "question" | "completion" | "notification";
  title: string;
  body: Record<string, unknown>;
  options: { label: string; description?: string }[];
  status: "pending";
  createdAt: string;
  resolvedAt: null;
  resolution: null;
  deliveredAt: null;
};

export class DirectProvider implements SessionProvider {
  readonly mode = "direct" as const;

  private runtimes = new Map<string, HostRuntime>();
  private sessions: DirectSession[] = [];
  private decisions: DirectDecision[] = [];
  private timer: NodeJS.Timeout | null = null;
  private refreshing = false;
  private onEvent: ((e: ProviderEvent) => void) | null = null;
  private shouldPoll: (() => boolean) | null = null;

  start(onEvent: (e: ProviderEvent) => void, shouldPoll?: () => boolean): () => void {
    this.onEvent = onEvent;
    this.shouldPoll = shouldPoll ?? null;
    this.syncHosts();
    void this.refresh();
    this.timer = setInterval(() => {
      // Same gate the hosted stream uses: no work while the app is backgrounded.
      if (this.shouldPoll && !this.shouldPoll()) return;
      void this.refresh();
    }, REFRESH_MS);

    return () => {
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      for (const rt of this.runtimes.values()) rt.channel.close();
      this.runtimes.clear();
      flushNow();
      this.onEvent = null;
    };
  }

  /** Open channels for newly-enabled hosts, close them for disabled ones. */
  private syncHosts(): void {
    const wanted = new Map(enabledHosts().map((h) => [h.id, h]));

    for (const [id, rt] of [...this.runtimes]) {
      if (!wanted.has(id)) { rt.channel.close(); this.runtimes.delete(id); }
    }

    for (const [id, host] of wanted) {
      if (this.runtimes.has(id)) continue;
      const target = sshTargetOf(host);
      const channel = new ProbeChannel(
        { machine: host.label, ssh: target ?? undefined },
        {
          onReady: () => recordStatus(id, true),
          onState: (state, detail) => {
            if (state === "backoff") recordStatus(id, false, detail);
          },
        },
      );
      channel.connect();
      this.runtimes.set(id, { host, channel, engine: new SessionEngine(channel, host.label) });
    }
  }

  private async refresh(): Promise<void> {
    if (this.refreshing) return; // a slow host must not stack up refreshes
    this.refreshing = true;
    try {
      this.syncHosts();
      const all: DirectSession[] = [];
      await Promise.all(
        [...this.runtimes.values()].map(async (rt) => {
          if (rt.channel.getState() !== "ready") return;
          try {
            all.push(...(await rt.engine.refresh()));
          } catch {
            // One unreachable host must not blank the cockpit for every other host.
          }
        }),
      );

      this.sessions = all;
      this.decisions = deriveDecisions(all);
      prune(new Set(all.map((s) => s.id)));
      // Same event the SSE stream emits, so the renderer's refresh path is identical.
      this.onEvent?.({ type: "poll.tick", payload: null });
    } finally {
      this.refreshing = false;
    }
  }

  /** Apply locally-held user intent (pins, tags, snoozes) over derived facts. */
  private decorate(s: DirectSession): DirectSession {
    const it = intentFor(s.id);
    const pending = this.decisions.filter((d) => d.sessionId === s.id).length;
    return {
      ...s,
      tags: it.tags,
      userTodos: [] as never[],
      pinned: it.pinned,
      snoozedUntil: it.snoozedUntil,
      attachedAt: it.firstSeenAt,
      pendingDecisions: pending,
    };
  }

  private visible(): DirectSession[] {
    return this.sessions
      .filter((s) => !intentFor(s.id).closedAt)
      .map((s) => this.decorate(s));
  }

  // --- reads -------------------------------------------------------------

  async getSessions(): Promise<unknown[]> { return this.visible(); }

  async getPendingDecisions(): Promise<unknown[]> { return this.decisions; }

  /**
   * The waiting queue: sessions that need you, most urgent first.
   *
   * Derived here rather than server-side, but with the same ordering the cockpit's
   * auto-advance expects — pinned first, then whoever has been waiting longest.
   */
  async getQueue(): Promise<unknown[]> {
    const now = Date.now();
    return this.visible()
      .filter((s) => {
        if (s.status !== "waiting" && s.pendingDecisions === 0) return false;
        const snoozed = s.snoozedUntil ? Date.parse(s.snoozedUntil) > now : false;
        return !snoozed;
      })
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return Date.parse(a.waitingSince ?? "") - Date.parse(b.waitingSince ?? "");
      });
  }

  async getInventory(): Promise<unknown> {
    const hosts = [...this.runtimes.values()].map((rt) => ({
      id: rt.host.id,
      machine: rt.host.label,
      user: rt.host.user,
      os: rt.channel.getInfo()?.os ?? null,
      lastSeenAt: new Date().toISOString(),
    }));
    const sessions = this.sessions.map((s) => ({
      id: s.id,
      hostId: this.runtimes.get(LOCAL_OR(s.machine, this.runtimes))?.host.id ?? s.machine,
      machine: s.machine,
      cwd: s.cwd,
      folder: s.cwd.split("/").filter(Boolean).pop() ?? s.cwd,
      title: s.summary,
      lastActive: s.lastSeenAt ?? new Date().toISOString(),
      messageCount: s.transcript.length,
      sizeBytes: 0,
      source: s.wrapperId ? "cowork" : "external",
      tags: intentFor(s.id).tags,
    }));
    return { hosts, sessions };
  }

  async getTelemetry(): Promise<unknown[]> {
    const out: unknown[] = [];
    await Promise.all(
      [...this.runtimes.values()].map(async (rt) => {
        if (rt.channel.getState() !== "ready") return;
        try {
          const t = await rt.channel.request<Record<string, unknown>>("telemetry.sample");
          out.push({ machine: rt.host.label, ...t, geo: null });
        } catch {
          // telemetry is best-effort; a failing host just has no card
        }
      }),
    );
    return out;
  }

  // Docker and caps sampling land with the widgets phase; an empty list renders the
  // panel's existing "nothing here" state rather than an error.
  async getDocker(): Promise<unknown[]> { return []; }
  async getCaps(): Promise<unknown[]> { return []; }

  async getHosts(): Promise<ServerHost[]> {
    return [...this.runtimes.values()].map((rt) => ({
      id: rt.host.id,
      machine: rt.host.label,
      user: rt.host.user,
      address: rt.host.sshHost || null,
      sshPort: rt.host.port,
    }));
  }

  // --- writes: local intent (no host interaction) --------------------------

  async snooze(id: string, minutes: number): Promise<void> {
    updateIntent(id, { snoozedUntil: new Date(Date.now() + minutes * 60_000).toISOString() });
    this.onEvent?.({ type: "poll.tick", payload: null });
  }

  async pin(id: string, pinned: boolean): Promise<void> {
    updateIntent(id, { pinned });
    this.onEvent?.({ type: "poll.tick", payload: null });
  }

  async dismissSession(id: string): Promise<void> {
    updateIntent(id, { closedAt: new Date().toISOString() });
    this.onEvent?.({ type: "poll.tick", payload: null });
  }

  async addTag(sessionId: string, tag: string): Promise<unknown> {
    const it = intentFor(sessionId);
    if (!it.tags.includes(tag)) updateIntent(sessionId, { tags: [...it.tags, tag] });
    this.onEvent?.({ type: "poll.tick", payload: null });
    return { ok: true };
  }

  async removeTag(sessionId: string, tag: string): Promise<unknown> {
    const it = intentFor(sessionId);
    updateIntent(sessionId, { tags: it.tags.filter((t) => t !== tag) });
    this.onEvent?.({ type: "poll.tick", payload: null });
    return { ok: true };
  }

  async addUserTodo(sessionId: string, text: string): Promise<unknown> {
    const it = intentFor(sessionId);
    const todo = { id: `${Date.now()}`, text, done: false };
    updateIntent(sessionId, { userTodos: [...it.userTodos, todo] });
    this.onEvent?.({ type: "poll.tick", payload: null });
    return todo;
  }

  async toggleUserTodo(sessionId: string, todoId: string): Promise<unknown> {
    const it = intentFor(sessionId);
    updateIntent(sessionId, {
      userTodos: it.userTodos.map((t) => (t.id === todoId ? { ...t, done: !t.done } : t)),
    });
    this.onEvent?.({ type: "poll.tick", payload: null });
    return { ok: true };
  }

  async deleteUserTodo(sessionId: string, todoId: string): Promise<unknown> {
    const it = intentFor(sessionId);
    updateIntent(sessionId, { userTodos: it.userTodos.filter((t) => t.id !== todoId) });
    this.onEvent?.({ type: "poll.tick", payload: null });
    return { ok: true };
  }

  // --- writes: require tmux delivery (next phase) --------------------------

  private notYet(what: string): never {
    // Explicit rejection, not a silent no-op: a control that looks like it worked and
    // didn't is worse than one that says it can't. The cockpit surfaces this inline.
    throw new Error(`${what} needs tmux delivery, which isn't wired up in direct mode yet`);
  }

  async instruct(): Promise<unknown> { return this.notYet("Sending a message"); }
  async interrupt(): Promise<unknown> { return this.notYet("Interrupting"); }
  async switchMode(): Promise<unknown> { return this.notYet("Switching mode"); }

  async resolveDecision(id: string, _resolution: Resolution): Promise<unknown> {
    const d = this.decisions.find((x) => x.id === id);
    // A completion card is just an acknowledgement — nothing is typed into Claude, so
    // it can be dismissed today.
    if (d && d.kind === "completion") {
      markResolved(id);
      this.decisions = this.decisions.filter((x) => x.id !== id);
      this.onEvent?.({ type: "poll.tick", payload: null });
      return { ok: true };
    }
    return this.notYet("Answering");
  }
}

/** Resolve a machine name back to its runtime key. */
function LOCAL_OR(machine: string, runtimes: Map<string, HostRuntime>): string {
  for (const [id, rt] of runtimes) if (rt.host.label === machine) return id;
  return machine;
}

/**
 * Build decision cards from blocked sessions.
 *
 * `buildDecisionSpec` is the SAME function the on-host agent calls with a hook event —
 * a transcript `tool_use` block carries `{name, input}`, which is exactly the
 * `{tool_name, tool_input}` shape it expects. So the cards are byte-identical to the
 * hosted edition's and the existing UI renders them unchanged.
 */
export function deriveDecisions(sessions: DirectSession[]): DirectDecision[] {
  const out: DirectDecision[] = [];
  for (const s of sessions) {
    if (s.pendingDecisions === 0) continue;
    const tool = s.pendingToolName
      ? { tool_name: s.pendingToolName, tool_input: s.pendingToolInput as Record<string, unknown> }
      : null;
    if (!tool) continue;

    // Stable id: the same blocked tool call must produce the same card across refreshes,
    // or every tick would spawn a duplicate.
    const id = `${s.id}:${s.pendingToolId ?? tool.tool_name}`;
    if (isResolved(id)) continue;

    const spec = buildDecisionSpec(
      { hook_event_name: "PreToolUse", session_id: s.id, cwd: s.cwd, ...tool },
      /* deliverable */ s.live,
    );
    if (!spec) continue;
    out.push({
      id,
      sessionId: s.id,
      kind: spec.kind,
      title: spec.title,
      body: spec.body,
      options: spec.options,
      status: "pending",
      createdAt: s.waitingSince ?? new Date().toISOString(),
      resolvedAt: null,
      resolution: null,
      deliveredAt: null,
    });
  }
  return out;
}
