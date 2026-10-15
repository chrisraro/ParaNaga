// The Route N mark (design canvas: 01 · Route N identity): the N of Naga drawn as two
// transit routes meeting at a transfer stop.

type MarkProps = {
  size?: number;
  /** "full" = colored routes with stops; "glyph" = routes only, for small sizes. */
  variant?: "full" | "glyph";
  /** Stroke behind the transfer stop; match the surface the mark sits on. */
  surface?: string;
  title?: string;
};

export function RouteNMark({ size = 32, variant = "full", surface = "#0f1e3d", title }: MarkProps) {
  const a11y = title ? { role: "img", "aria-label": title } : { "aria-hidden": true };
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" {...a11y}>
      <path d="M32 90 V30 L60 60" fill="none" stroke="#2bb5ae" strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M60 60 L88 90 V30" fill="none" stroke="#f26b5b" strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" />
      {variant === "full" ? (
        <>
          <circle cx={32} cy={90} r={8.5} fill="#ffffff" />
          <circle cx={60} cy={60} r={10} fill="#ffffff" stroke={surface} strokeWidth={4} />
          <circle cx={88} cy={30} r={10} fill="#ffffff" />
          <circle cx={88} cy={30} r={4.5} fill="#f26b5b" />
        </>
      ) : (
        <circle cx={60} cy={60} r={9} fill="#ffffff" stroke={surface} strokeWidth={4} />
      )}
    </svg>
  );
}

/** App-icon tile: the mark on the navy squircle, as on the home screen. */
export function AppIconTile({ size = 30 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center bg-gradient-to-b from-navy-raised to-navy shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]"
      style={{ width: size, height: size, borderRadius: size * 0.235 }}
    >
      <RouteNMark size={Math.round(size * 0.78)} variant={size < 32 ? "glyph" : "full"} surface="#1d3870" />
    </span>
  );
}

export function Wordmark({ className = "" }: { className?: string }) {
  return <span className={`font-[family-name:var(--font-geist-sans)] font-extrabold tracking-[-0.04em] ${className}`}>paranaga</span>;
}
