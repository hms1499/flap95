/* The player bird, straight off the game canvas: gold body, black eye,
   orange beak — drawn on a 16-unit grid so it stays crisp at any size. */
export function PixelBird({ className }: { className?: string }) {
  return (
    <svg
      className={`pixelbird ${className ?? ''}`}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {/* body */}
      <rect x="3" y="4" width="9" height="8" fill="#ffd700" />
      <rect x="4" y="3" width="7" height="1" fill="#ffd700" />
      <rect x="4" y="12" width="7" height="1" fill="#ffd700" />
      {/* belly highlight */}
      <rect x="4" y="9" width="6" height="3" fill="#ffe867" />
      {/* wing */}
      <rect x="3" y="7" width="4" height="3" fill="#e8b000" />
      {/* eye */}
      <rect x="9" y="5" width="3" height="3" fill="#fff" />
      <rect x="10" y="6" width="2" height="2" fill="#000" />
      {/* beak */}
      <rect x="12" y="7" width="3" height="2" fill="#ff7a1a" />
      <rect x="12" y="9" width="2" height="1" fill="#d85e00" />
      {/* outline */}
      <rect x="3" y="3" width="1" height="1" fill="#000" opacity="0" />
    </svg>
  );
}
