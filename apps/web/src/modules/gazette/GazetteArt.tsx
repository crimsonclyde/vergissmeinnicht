/**
 * The Gazette's engraving (43): Ligurian ridges, a hill village, terraces, cypresses and forget-me-not
 * sprigs, drawn in line work with `currentColor` so every theme tints it through its own tokens. Static:
 * nothing moves, so reduced motion needs nothing. Decorative only.
 */
export function GazetteLandscape({ className }: { className?: string }) {
  const flower = (x: number, y: number, scale = 1) => (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <circle cx="0" cy="-9" r="5" /><circle cx="8.5" cy="-3" r="5" /><circle cx="5" cy="7" r="5" /><circle cx="-5" cy="7" r="5" /><circle cx="-8.5" cy="-3" r="5" />
    </g>
  );
  return (
    <svg className={className} viewBox="0 0 1200 250" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
        <g className="gazette-art-sky" strokeWidth="1" strokeDasharray="2 7"><path d="M0 40h1200M0 52h1200M0 64h1200M0 76h1200" /></g>
        <g className="gazette-art-sun">
          <circle cx="900" cy="78" r="30" strokeWidth="1.4" />
          <path d="M860 78h-40M940 78h40M900 38V20M900 118v14M872 50l-12-12M928 50l12-12" strokeWidth="1" />
        </g>
        <path className="gazette-art-far" d="M0 150 C90 120 160 128 240 108 S380 70 450 96 560 140 640 118 760 70 840 92 980 130 1060 112 1160 96 1200 104" strokeWidth="1.6" />
        <g className="gazette-art-hatch" strokeWidth="1"><path d="M60 150l30-22M120 140l30-24M300 104l26-18M470 112l26-12M700 104l28-22M1000 126l26-16" /></g>
        <path className="gazette-art-mid" d="M0 190 C120 160 210 170 300 150 S470 120 560 146 700 196 820 170 980 140 1080 158 1200 150" strokeWidth="2" />
        <g className="gazette-art-village" strokeWidth="1.6">
          <path d="M470 132v-20h16v20M486 132v-28l9-9 9 9v28M504 132v-16h18v16M522 132v-24h12v24M534 132v-12h16v12" />
          <path d="M495 95v-12M491 87h8" />
          <path d="M476 120h4M512 122h4M526 116h4M540 124h4" strokeWidth="2.2" />
        </g>
        <g className="gazette-art-hatch" strokeWidth="1.1"><path d="M330 178c40-6 70-8 110-4M350 188c40-6 70-6 110-2M600 168c40 4 80 12 120 10M620 180c40 4 80 10 120 8" /></g>
        <g className="gazette-art-olives" strokeWidth="2.4"><path d="M360 172h.01M392 170h.01M424 171h.01M640 170h.01M672 174h.01M704 176h.01M376 184h.01M410 182h.01M660 184h.01M690 186h.01" /></g>
        <path className="gazette-art-near" d="M0 232 C150 214 330 222 480 212 S800 214 960 222 1200 216 1200 216" strokeWidth="2.4" />
        <g className="gazette-art-trees" strokeWidth="1.6"><path d="M760 214c-6-20-4-46 4-62 8 16 10 42 4 62zM784 218c-5-16-3-36 3-48 6 12 8 32 3 48zM180 220c-6-22-4-48 4-64 8 16 10 42 4 64z" /></g>
        <g className="gazette-art-sprig" strokeWidth="1.8">
          <path d="M1150 250c-12-40-22-78-60-110M1112 176c18-6 30-2 40 6M1098 156c-18-8-34-2-42 8" />
          {flower(1082, 132)}{flower(1048, 120, 0.75)}
          <path d="M22 250c10-36 26-62 54-82M44 206c-14-4-26 2-32 10M58 190c14-8 28-6 36 2" />
          {flower(82, 162, 0.8)}
        </g>
      </g>
      <g className="gazette-art-hearts" fill="currentColor"><circle cx="1082" cy="132" r="2" /><circle cx="1048" cy="120" r="1.6" /><circle cx="82" cy="162" r="1.6" /></g>
    </svg>
  );
}

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
