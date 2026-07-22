import { useEffect, useRef } from "react";
import ambientUrl from "../assets/sfx/ambient.mp3?url";
import { useAppearance } from "../appearance";

/**
 * Looping hi-tech background ambiance. Volume follows Settings › Appearance
 * (ambientVolume, default 30%, 0 = off). Autoplay may be blocked by Chromium until
 * the first user gesture, so we attempt playback immediately AND retry once on the
 * first pointer/key interaction. Mounted once in the cockpit.
 */
export default function AmbientAudio() {
  const vol = useAppearance().ambientVolume / 100;
  const ref = useRef<HTMLAudioElement>(null);

  // Keep the element's volume in sync; pause entirely when the user sets it to 0.
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    a.volume = Math.max(0, Math.min(1, vol));
    if (vol <= 0) {
      a.pause();
    } else if (a.paused) {
      a.play().catch(() => {});
    }
  }, [vol]);

  // Kick off playback (retrying on the first gesture if autoplay was blocked).
  useEffect(() => {
    const a = ref.current;
    if (!a) return;
    const tryPlay = () => {
      if (a.volume > 0) a.play().catch(() => {});
    };
    tryPlay();
    const onGesture = () => { tryPlay(); cleanup(); };
    const cleanup = () => {
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
    };
    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    return cleanup;
  }, []);

  return <audio ref={ref} src={ambientUrl} loop preload="auto" />;
}
