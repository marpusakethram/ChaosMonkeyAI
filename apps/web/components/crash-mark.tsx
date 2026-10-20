/** The quadrant target painted on crash-test dummies. */
export function CrashMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="11" fill="#f7b928" />
      <path d="M12 1a11 11 0 0 1 11 11H12z" fill="#0a1317" />
      <path d="M12 23A11 11 0 0 1 1 12h11z" fill="#0a1317" />
      <circle cx="12" cy="12" r="11" fill="none" stroke="#0a1317" strokeWidth="1.5" />
    </svg>
  );
}
