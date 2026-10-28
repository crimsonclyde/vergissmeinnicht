/** Original, bundled line art. Decoration only; every theme keeps the same heading and controls. */
export function EverydaySigil() {
  return <span className="everyday-sigil" aria-hidden="true">
    <svg className="everyday-hourglass" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.25">
      <circle cx="24" cy="24" r="21" strokeDasharray="1 5" />
      <path d="M15 11h18M15 37h18M17 12c0 8 2 9 7 12-5 3-7 4-7 12m14-24c0 8-2 9-7 12 5 3 7 4 7 12" />
      <path d="m20 17 4 4 4-4M19 33l5-5 5 5Z" fill="currentColor" stroke="none" />
    </svg>
    <svg className="everyday-daylight" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.25">
      <circle cx="24" cy="24" r="21" strokeDasharray="1 5" />
      <path d="M10 29h28M14 34h20M19 38h10M16 27a8 8 0 0 1 16 0M24 8v6m-12 1 4 4m20-4-4 4M8 23h5m22 0h5" />
    </svg>
  </span>;
}
