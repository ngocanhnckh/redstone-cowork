import { useEffect, useRef } from "react";
import ambientUrl from "../assets/sfx/ambient.mp3?url";
import { useAppearance } from "../appearance";

/**
 * Looping hi-tech background ambiance. Volume follows Settings › Appearance
 * (ambientVolume, default 30%, 0 = off). Autoplay may be blocked by Chromium until
 * the first user gesture, so we attempt playback immediately AND retry once on the
 * first pointer/key interaction. Mounted once in the cockpit.
 */
export default function AmbientAudio({ enabled = true }: { enabled?: boolean }) {
  const vol = useAppearance().ambientVolume / 100;
  const ref = useRef<HTMLAudioElement>(null);
  const active = enabled && vol > 0; // only play once the boot splash is done AND volume > 0

  // Keep the element's volume in sync; play/pause on the active gate.
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    a.volume = Math.max(0, Math.min(1, vol));
    if (!active) a.pause();
    else if (a.paused) a.play().catch(() => {});
  }, [vol, active]);

  // Kick off playback when active (retrying on the first gesture if autoplay was
  // blocked). Runs when `active` flips true — i.e. after the boot splash completes.
  useEffect(() => {
    const a = ref.current;
    if (!a || !active) return;
    const tryPlay = () => { if (active) a.play().catch(() => {}); };
    tryPlay();
    const onGesture = () => { tryPlay(); cleanup(); };
    const cleanup = () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return cleanup;
  }, [active]);

  return <audio ref={ref} src={ambientUrl} loop preload="auto" />;
}
