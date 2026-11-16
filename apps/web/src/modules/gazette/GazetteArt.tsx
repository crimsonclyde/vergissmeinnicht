/** The section divider: a single forget-me-not between two rules. */
export function GazetteOrnament() {
  return (
    <div className="gazette-ornament" aria-hidden="true">
      <svg viewBox="0 0 60 20" focusable="false">
        <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          <circle cx="30" cy="10" r="3" /><circle cx="30" cy="3.5" r="3" /><circle cx="36" cy="8" r="3" /><circle cx="34" cy="15" r="3" /><circle cx="26" cy="15" r="3" /><circle cx="24" cy="8" r="3" />
          <path d="M20 10c-4-5-8-5-12-2M40 10c4 5 8 5 12 2" />
        </g>
      </svg>
    </div>
  );
}
