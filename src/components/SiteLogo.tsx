/** Minimal 2×2 grid mark — diagonal “word path” in accent green. */
export function SiteLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden
    >
      <rect width="32" height="32" rx="8" className="site-logo__bg" />
      <rect x="4" y="4" width="11" height="11" rx="2.75" className="site-logo__tile site-logo__tile--active" />
      <rect x="17" y="4" width="11" height="11" rx="2.75" className="site-logo__tile" />
      <rect x="4" y="17" width="11" height="11" rx="2.75" className="site-logo__tile" />
      <rect
        x="17"
        y="17"
        width="11"
        height="11"
        rx="2.75"
        className="site-logo__tile site-logo__tile--active"
      />
    </svg>
  );
}
