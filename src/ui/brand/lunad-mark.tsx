// The Lunad mark: an L drawn as a route, with a start node, one turn and a dot for the stop.
// It is always drawn on its tile, so it reads the same on any surface. The app icons
// (src/app/icon.svg, apple-icon.png, favicon.ico, public/icons/*) use the same geometry.

const TONES = {
  /** The app-icon tile: brand green, white line. */
  green: { tile: "#0B6B52", line: "#ffffff" },
  /** For dark surfaces, where the green tile would sink in. */
  bright: { tile: "#2FBF93", line: "#04221A" },
} as const;

type MarkProps = {
  size?: number;
  tone?: keyof typeof TONES;
  /** "full" = with the start node; "glyph" = line and stop only, for small sizes. */
  variant?: "full" | "glyph";
  /** Names the image for assistive tech; without it the mark is decorative. */
  title?: string;
};

export function LunadMark({ size = 32, tone = "green", variant = size < 24 ? "glyph" : "full", title }: MarkProps) {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true };
  const { tile, line } = TONES[tone];
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" className="shrink-0" {...a11y}>
      <rect width={96} height={96} rx={22} fill={tile} />
      {/* The drawing spans x 27–81; the shift centres it in the tile. */}
      <g transform="translate(-6 0)">
        <path d="M33 22V56a14 14 0 0 0 14 14h3" fill="none" stroke={line} strokeWidth={12} strokeLinecap="round" />
        {variant === "full" ? <circle cx={33} cy={22} r={4} fill={tile} /> : null}
        <circle cx={71} cy={70} r={10} fill="#FFB81C" />
      </g>
    </svg>
  );
}

export function LunadWordmark({ className = "" }: { className?: string }) {
  return <span className={`font-[family-name:var(--font-geist-sans)] font-extrabold tracking-[-0.04em] ${className}`}>lunad</span>;
}
