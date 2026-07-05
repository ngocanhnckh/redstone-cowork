import { useEffect, useRef, useState } from "react";
import { useAppearance } from "../appearance";

/**
 * Optional looping background video (with audio) shown as the app backdrop instead
 * of the desktop wallpaper. Streamed from the main process over rcw-media://. Sits
 * behind everything (fixed, z-index -1) so the glass shell frosts/tints it in
 * normal mode and it shows through the gaps in transparent HUD mode. Reloads on the
 * `rcw-bgvideo` event (dispatched when the video is changed in Settings).
 */
export default function BgVideo() {
  const { videoMuted } = useAppearance();
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const load = () => window.cowork.getBgVideo().then((u) => setUrl(u ?? null)).catch(() => setUrl(null));
    load();
    const h = () => load();
    window.addEventListener("rcw-bgvideo", h);
    return () => window.removeEventListener("rcw-bgvideo", h);
  }, []);

  // Keep mute in sync and (re)start playback when the source or mute changes.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = videoMuted;
    const p = v.play();
    if (p) p.catch(() => { /* autoplay may still be gated on some setups */ });
  }, [url, videoMuted]);

  // Safety net: if the video ever pauses (e.g. an occlusion/fullscreen throttle
  // slips through), resume it — the background video should never sit frozen.
  useEffect(() => {
    const v = ref.current;
    if (!v || !url) return;
    const resume = () => { const p = v.play(); if (p) p.catch(() => {}); };
    v.addEventListener("pause", resume);
    const onVis = () => { if (document.visibilityState === "visible") resume(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { v.removeEventListener("pause", resume); document.removeEventListener("visibilitychange", onVis); };
  }, [url]);

  if (!url) return null;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: -1, overflow: "hidden", pointerEvents: "none", background: "#000" }}>
      <video
        ref={ref}
        src={url}
        autoPlay
        loop
        playsInline
        muted={videoMuted}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
}
