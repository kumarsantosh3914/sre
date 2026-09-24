// Wordmark: a callout balloon with its leader line — the product's
// mechanism (every claim points at its evidence) as the mark.
export function Logo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ''}`}>
      <svg aria-hidden viewBox="0 0 28 28" className="h-7 w-7 text-signal" fill="none">
        <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M15.2 15.2 25 25" stroke="currentColor" strokeWidth="1.5" />
        <path d="M22 25h3v-3" stroke="currentColor" strokeWidth="1.5" />
        <text
          x="10"
          y="13.4"
          textAnchor="middle"
          fontSize="9.5"
          fontWeight="700"
          fill="currentColor"
          fontFamily="Archivo Variable, sans-serif"
        >
          1
        </text>
      </svg>
      <span className="text-lg font-bold tracking-[-0.02em] text-ink">
        SRE<span className="text-signal">.</span>ai
      </span>
    </span>
  );
}
