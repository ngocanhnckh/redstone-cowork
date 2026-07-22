/**
 * Sci-fi loading spinner — concentric counter-rotating HUD arcs around a pulsing
 * core. Pure CSS (see .scifi-spinner in globals.css); colours come from the theme
 * tokens, so it's clay in the warm theme and cyan in hi-tech. Replaces the plain
 * "thinking dots" while Claude is streaming.
 */
export default function SciFiSpinner({ size = 26 }: { size?: number }) {
  return (
    <span className="scifi-spinner" style={{ width: size, height: size }} aria-label="working" role="img">
      <i />
      <i />
      <i />
      <b />
    </span>
  );
}
