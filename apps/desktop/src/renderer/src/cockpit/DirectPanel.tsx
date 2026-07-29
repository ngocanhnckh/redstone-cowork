import { useCallback, useEffect, useState } from "react";
import { IconLaptop, IconMonitor, IconPlus, IconRefresh, IconTrash } from "./Icons";

/**
 * Backend selection + the host book for the direct (agent-free) edition.
 *
 * Direct mode reaches each machine straight over SSH — no cowork server in the data
 * path and nothing installed on the host. This panel is where you switch backend and
 * choose which machines to connect to.
 *
 * Every mutating control reports its outcome inline, next to the control that was
 * pressed (per CLAUDE.md): disabled + progress label while in flight, then an explicit
 * confirmation or the error. Failures stay until the next attempt; successes fade.
 */

type HostEntry = {
  id: string;
  label: string;
  sshHost: string;
  user: string | null;
  port: number | null;
  source: "local" | "manual" | "ssh-config";
  enabled: boolean;
  lastOkAt: string | null;
  lastError: string | null;
};

type ModeInfo = { mode: string; choice: string | null; available: boolean; implicit: boolean };

type Outcome = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "ok"; msg: string } | { kind: "err"; msg: string };

const labelStyle: React.CSSProperties = { display: "block", fontSize: 11, letterSpacing: 0.3, margin: "0 2px 6px" };
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 11px", fontSize: 13, borderRadius: 10,
  border: "1px solid var(--border)", background: "rgba(0,0,0,0.18)", color: "var(--text)",
  fontFamily: "var(--font-mono)",
};

/** Inline outcome line. Errors persist; successes fade after ~2.5s (handled by caller). */
function OutcomeLine({ state }: { state: Outcome }) {
  if (state.kind === "idle") return null;
  const color =
    state.kind === "err" ? "rgb(230 99 86)" : state.kind === "ok" ? "rgb(126 200 140)" : "var(--text-soft)";
  return (
    <div style={{ fontSize: 11.5, color, margin: "6px 2px 0", lineHeight: 1.45, fontFamily: "var(--font-mono)" }}>
      {state.kind === "busy" ? `${state.label}…` : state.kind === "ok" ? state.msg : state.msg}
    </div>
  );
}

export default function DirectPanel() {
  const [info, setInfo] = useState<ModeInfo | null>(null);
  const [hosts, setHosts] = useState<HostEntry[]>([]);
  const [modeOutcome, setModeOutcome] = useState<Outcome>({ kind: "idle" });
  const [hostOutcome, setHostOutcome] = useState<Record<string, Outcome>>({});
  const [addOutcome, setAddOutcome] = useState<Outcome>({ kind: "idle" });
  const [newHost, setNewHost] = useState("");
  const [newUser, setNewUser] = useState("");

  const load = useCallback(async () => {
    try {
      const [m, h] = await Promise.all([window.cowork.directMode(), window.cowork.directHosts()]);
      setInfo(m as ModeInfo);
      setHosts(h as HostEntry[]);
    } catch {
      // panel simply shows nothing rather than throwing into the modal
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const fade = (set: (o: Outcome) => void, msg: string) => {
    set({ kind: "ok", msg });
    setTimeout(() => set({ kind: "idle" }), 2500);
  };

  const setMode = async (mode: "cloud" | "direct") => {
    setModeOutcome({ kind: "busy", label: mode === "direct" ? "Switching to direct" : "Switching to server" });
    try {
      await window.cowork.directModeSet(mode);
      await load();
      fade(setModeOutcome, mode === "direct" ? "Now connecting over SSH." : "Now using the cowork server.");
    } catch (e) {
      // Stays until the next attempt — an unread failure must never auto-dismiss.
      setModeOutcome({ kind: "err", msg: e instanceof Error ? e.message : "Could not switch backend." });
    }
  };

  const toggleHost = async (h: HostEntry) => {
    setHostOutcome((s) => ({ ...s, [h.id]: { kind: "busy", label: h.enabled ? "Disconnecting" : "Connecting" } }));
    try {
      await window.cowork.directHostEnable(h.id, !h.enabled);
      await load();
      setHostOutcome((s) => ({ ...s, [h.id]: { kind: "ok", msg: h.enabled ? "Disconnected." : "Connecting over SSH." } }));
      setTimeout(() => setHostOutcome((s) => ({ ...s, [h.id]: { kind: "idle" } })), 2500);
    } catch (e) {
      setHostOutcome((s) => ({ ...s, [h.id]: { kind: "err", msg: e instanceof Error ? e.message : "Failed." } }));
    }
  };

  const removeHost = async (h: HostEntry) => {
    setHostOutcome((s) => ({ ...s, [h.id]: { kind: "busy", label: "Removing" } }));
    try {
      await window.cowork.directHostRemove(h.id);
      await load();
    } catch (e) {
      setHostOutcome((s) => ({ ...s, [h.id]: { kind: "err", msg: e instanceof Error ? e.message : "Failed." } }));
    }
  };

  const addHost = async () => {
    const sshHost = newHost.trim();
    if (!sshHost) { setAddOutcome({ kind: "err", msg: "Enter a hostname or ~/.ssh/config alias." }); return; }
    setAddOutcome({ kind: "busy", label: "Adding" });
    try {
      await window.cowork.directHostAdd({ sshHost, user: newUser.trim() || null });
      setNewHost(""); setNewUser("");
      await load();
      fade(setAddOutcome, `Added ${sshHost}.`);
    } catch (e) {
      setAddOutcome({ kind: "err", msg: e instanceof Error ? e.message : "Could not add that host." });
    }
  };

  const isDirect = info?.mode === "direct";
  const configured = hosts.filter((h) => h.source !== "ssh-config" || h.enabled);
  const suggestions = hosts.filter((h) => h.source === "ssh-config" && !h.enabled);

  return (
    <div style={{ marginTop: 26, paddingTop: 22, borderTop: "1px solid var(--border)" }}>
      <span className="kicker">Backend</span>
      <h2 className="display" style={{ fontSize: 20, margin: "2px 0 12px" }}>How the cockpit connects</h2>

      <div style={{ display: "flex", gap: 6, padding: 4, border: "1px solid var(--border)", borderRadius: 11 }}>
        {([
          { key: "cloud", label: "Cowork server", hint: "Hosts run the agent" },
          { key: "direct", label: "Direct SSH", hint: "Nothing installed" },
        ] as const).map((opt) => {
          const active = info ? info.mode === opt.key : false;
          return (
            <button
              key={opt.key}
              onClick={() => void setMode(opt.key)}
              disabled={modeOutcome.kind === "busy"}
              style={{
                flex: 1, padding: "8px 6px", textAlign: "center", cursor: modeOutcome.kind === "busy" ? "default" : "pointer",
                borderRadius: 8, border: 0, opacity: modeOutcome.kind === "busy" ? 0.6 : 1,
                background: active ? "rgba(232,230,225,0.28)" : "transparent",
                color: active ? "#fff" : "var(--text-soft)",
              }}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{opt.label}</div>
              <div className="faint" style={{ fontSize: 10.5, marginTop: 2 }}>{opt.hint}</div>
            </button>
          );
        })}
      </div>
      <OutcomeLine state={modeOutcome} />

      {info?.implicit && (
        <p style={{ fontSize: 11.5, margin: "10px 2px 0", lineHeight: 1.55, color: "var(--text-soft)" }}>
          You're signed in, so the cockpit is using the <strong>cowork server</strong>. Sessions come
          from the agent installed on each machine. Choose Direct SSH above to connect over SSH instead.
        </p>
      )}

      <p className="faint" style={{ fontSize: 11, margin: "10px 2px 0", lineHeight: 1.55 }}>
        Direct SSH connects to each machine itself — no server in the path and no agent to install.
        New sessions start as plain tmux + claude. Signing in still enables the leaderboard,
        targets and shared machines.
      </p>

      {isDirect && (
        <>
          <div style={{ marginTop: 22, display: "flex", alignItems: "center", gap: 8 }}>
            <span className="kicker">Machines</span>
            <span style={{ flex: 1 }} />
            <button onClick={() => void load()} title="Refresh" style={{ background: "transparent", border: 0, cursor: "pointer", color: "var(--text-soft)", display: "flex" }}>
              <IconRefresh size={14} />
            </button>
          </div>

          {configured.map((h) => {
            const state = hostOutcome[h.id] ?? { kind: "idle" as const };
            return (
              <div key={h.id} style={{ marginTop: 10, padding: "10px 12px", border: "1px solid var(--border)", borderRadius: 11 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ color: "var(--text-soft)", display: "flex" }}>
                    {h.source === "local" ? <IconLaptop size={14} /> : <IconMonitor size={14} />}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {h.label}
                    </div>
                    <div className="faint" style={{ fontSize: 10.5, fontFamily: "var(--font-mono)" }}>
                      {h.source === "local"
                        ? "this machine · no SSH"
                        : `${h.user ? `${h.user}@` : ""}${h.sshHost}${h.port ? `:${h.port}` : ""}`}
                      {h.lastError ? ` · ${h.lastError}` : h.lastOkAt ? " · connected" : ""}
                    </div>
                  </div>
                  {h.source !== "local" && (
                    <>
                      <button
                        onClick={() => void toggleHost(h)}
                        disabled={state.kind === "busy"}
                        style={{
                          fontSize: 11.5, padding: "5px 10px", borderRadius: 8, cursor: "pointer",
                          border: "1px solid var(--border-strong)", background: "transparent",
                          color: "var(--text)", opacity: state.kind === "busy" ? 0.6 : 1,
                        }}
                      >
                        {h.enabled ? "Disconnect" : "Connect"}
                      </button>
                      <button onClick={() => void removeHost(h)} title="Remove" style={{ background: "transparent", border: 0, cursor: "pointer", color: "var(--text-soft)", display: "flex" }}>
                        <IconTrash size={13} />
                      </button>
                    </>
                  )}
                </div>
                <OutcomeLine state={state} />
              </div>
            );
          })}

          {suggestions.length > 0 && (
            <>
              <p className="faint" style={{ fontSize: 11, margin: "16px 2px 6px" }}>
                From ~/.ssh/config — connect the ones you want. They stay off until you choose.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {suggestions.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => void toggleHost(h)}
                    disabled={(hostOutcome[h.id] ?? { kind: "idle" }).kind === "busy"}
                    style={{
                      fontSize: 11.5, padding: "5px 10px", borderRadius: 8, cursor: "pointer",
                      border: "1px solid var(--border)", background: "transparent",
                      color: "var(--text-soft)", fontFamily: "var(--font-mono)",
                    }}
                  >
                    + {h.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <label className="soft" style={{ ...labelStyle, marginTop: 18 }}>Add a machine</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={newHost}
              onChange={(e) => setNewHost(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void addHost(); }}
              placeholder="hostname, IP, or ~/.ssh/config alias"
              autoCapitalize="off" autoCorrect="off" spellCheck={false}
              style={{ ...inputStyle, flex: 2 }}
            />
            <input
              value={newUser}
              onChange={(e) => setNewUser(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void addHost(); }}
              placeholder="user"
              autoCapitalize="off" autoCorrect="off" spellCheck={false}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={() => void addHost()}
              disabled={addOutcome.kind === "busy"}
              title="Add"
              style={{
                padding: "0 12px", borderRadius: 10, cursor: "pointer", display: "flex", alignItems: "center",
                border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text)",
                opacity: addOutcome.kind === "busy" ? 0.6 : 1,
              }}
            >
              <IconPlus size={14} />
            </button>
          </div>
          <OutcomeLine state={addOutcome} />
          <p className="faint" style={{ fontSize: 11, margin: "8px 2px 0", lineHeight: 1.5 }}>
            Leave the user blank to let ssh resolve it from your config. Authentication uses your own
            keys or agent — nothing is sent anywhere.
          </p>
        </>
      )}
    </div>
  );
}
