import { useEffect, useRef } from "react";
import { useStore } from "../store";
import { setThinking, playSfx } from "../sfx";

const ACTIONABLE = ["question", "permission", "mode"];

/**
 * Drives the looping "Claude is thinking" ambience from the FOCUSED session's working
 * state — mode-independently. It lives in Cockpit (mounted in Flow, Grid AND HUD),
 * because FocusStage (the old driver) only exists in Flow mode, so the loop never
 * played in HUD. Mirrors the isWorking condition FocusStage/Hud use for the spinner.
 */
export default function ThinkingSound() {
  const sessions = useStore((s) => s.sessions);
  const queue = useStore((s) => s.queue);
  const focusId = useStore((s) => s.focusId);
  const workingStale = useStore((s) => s.workingStale);
  const decisions = useStore((s) => s.decisions);
  const pending = useStore((s) => s.pending);

  const session = sessions.find((x) => x.id === focusId) ?? queue.find((x) => x.id === focusId);
  const actionable = !!focusId && decisions.some((d) => d.sessionId === focusId && ACTIONABLE.includes(d.kind));
  const pend = focusId ? (pending[focusId]?.length ?? 0) : 0;
  const isWorking =
    !!session && session.status !== "lost" && !actionable &&
    ((!!session.working && !workingStale[session.id]) || pend > 0);

  useEffect(() => {
    setThinking(isWorking);
    return () => setThinking(false);
  }, [isWorking]);

  // Chime when the focused session FINISHES a reply (working true → false). Background
  // sessions are handled by CompletionNotifier, so together every reply makes a sound.
  const wasWorking = useRef(false);
  useEffect(() => {
    if (wasWorking.current && !isWorking) playSfx("message");
    wasWorking.current = isWorking;
  }, [isWorking]);

  return null;
}
