import { memo } from 'react';
import { useThemeMode } from './theme.ts';

/**
 * The night city behind every page in the Tokyo Nights preset (24.1): sky, stars, Mount Fuji, a striped
 * sunset sun, a skyline with Tokyo Tower, lit windows and neon signs, and the Tron floor in front of it.
 * Pure decoration (aria-hidden, no pointer events), rendered only while the preset is chosen. Its motion
 * (blinking lights, flickering signs, the running floor, a shooting star) lives in tokyo-nights.css and
 * stops under prefers-reduced-motion.
 */
export function CityScene() {
  const [mode] = useThemeMode();
  if (mode !== 'tokyo-nights') return null;
  return <City />;
}

const W = 1600;
const GROUND = 400;

/** A small seeded random generator, so the city is the same on every visit and every device. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

interface Building {
  readonly x: number;
  readonly w: number;
  readonly top: number;
  readonly shape: 'flat' | 'step' | 'spire' | 'slant';
}

function buildings(random: () => number, min: number, max: number, minW: number, maxW: number, skip?: (x: number) => boolean): Building[] {
  const shapes: Building['shape'][] = ['flat', 'flat', 'step', 'spire', 'slant'];
  const list: Building[] = [];
  let x = -20;
  while (x < W + 20) {
    const w = Math.round(minW + random() * (maxW - minW));
    const h = Math.round(min + random() ** 1.6 * (max - min));
    if (skip?.(x + w / 2) !== true) list.push({ x, w, top: GROUND - h, shape: shapes[Math.floor(random() * shapes.length)] ?? 'flat' });
    x += w + (random() < 0.3 ? Math.round(random() * 10) : 0);
  }
  return list;
}

/** The outline of one building, roof shape included. */
function outline(b: Building): string {
  const { x, w, top } = b;
  const r = x + w;
  switch (b.shape) {
    case 'step':
      return `M${x} ${GROUND}V${top + 18}H${x + w * 0.2}V${top}H${r - w * 0.2}V${top + 18}H${r}V${GROUND}Z`;
    case 'spire': {
      const mid = x + w / 2;
      return `M${x} ${GROUND}V${top}H${mid - 3}V${top - 34}H${mid + 3}V${top}H${r}V${GROUND}Z`;
    }
    case 'slant':
      return `M${x} ${GROUND}V${top + 22}L${r} ${top}V${GROUND}Z`;
    default:
      return `M${x} ${GROUND}V${top}H${r}V${GROUND}Z`;
  }
}

/** Lit windows of a row of buildings, as one path per colour (few elements, cheap to paint). */
function windows(random: () => number, list: readonly Building[], share: number): [string, string, string] {
  const paths: [string, string, string] = ['', '', ''];
  for (const b of list) {
    for (let y = b.top + 26; y < GROUND - 12; y += 11) {
      for (let x = b.x + 5; x < b.x + b.w - 7; x += 8) {
        const roll = random();
        if (roll > share) continue;
        const colour = roll < share * 0.6 ? 0 : roll < share * 0.85 ? 1 : 2;
        paths[colour] += `M${x} ${y}h3v5h-3z`;
      }
    }
  }
  return paths;
}

/** Tokyo Tower: a tapering lattice with two observation decks. */
function towerPath(cx: number, base: number, height: number): string {
  const top = base - height;
  const half = (y: number) => 4 + ((y - top) / height) ** 1.7 * 46;
  let d = `M${cx - half(base)} ${base}L${cx - 2} ${top}L${cx + 2} ${top}L${cx + half(base)} ${base}`;
  for (let i = 1; i < 9; i += 1) {
    const y1 = top + (height * (i - 1)) / 8;
    const y2 = top + (height * i) / 8;
    d += `M${cx - half(y1)} ${y1}L${cx + half(y2)} ${y2}M${cx + half(y1)} ${y1}L${cx - half(y2)} ${y2}M${cx - half(y2)} ${y2}H${cx + half(y2)}`;
  }
  return d;
}

const City = memo(function City() {
  const random = seeded(20261020);
  const towerX = 880;
  const far = buildings(random, 50, 170, 34, 80);
  const near = buildings(random, 30, 120, 28, 70, (x) => Math.abs(x - towerX) < 30);
  const [farA, farB, farC] = windows(random, far, 0.12);
  const [nearA, nearB, nearC] = windows(random, near, 0.2);
  // Neon signs: vertical boards on a few near buildings.
  const signs = near
    .filter((b) => b.w > 40 && GROUND - b.top > 70)
    .filter((_, index) => index % 3 === 0)
    .slice(0, 7)
    .map((b, index) => ({ x: b.x + (index % 2 === 0 ? 4 : b.w - 12), y: b.top + 14, h: Math.min(60, GROUND - b.top - 30), tone: index % 3 }));
  return (
    <div className="city" aria-hidden="true">
      <div className="city-sky" />
      <div className="city-star" />
      <svg className="city-skyline" viewBox={`0 0 ${W} ${GROUND}`} preserveAspectRatio="xMidYMax slice" focusable="false">
        <defs>
          <linearGradient id="city-sun" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffd86b" />
            <stop offset="0.55" stopColor="#ff7a6b" />
            <stop offset="1" stopColor="#e8389a" />
          </linearGradient>
          <radialGradient id="city-glow">
            <stop offset="0" stopColor="#ff5ccd" stopOpacity="0.45" />
            <stop offset="0.5" stopColor="#9d7cff" stopOpacity="0.15" />
            <stop offset="1" stopColor="#9d7cff" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="city-fuji" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3a2f6e" />
            <stop offset="1" stopColor="#1a1640" />
          </linearGradient>
          <linearGradient id="city-haze" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0a0b1a" stopOpacity="0" />
            <stop offset="1" stopColor="#ff5ccd" stopOpacity="0.18" />
          </linearGradient>
          <mask id="city-sun-cut">
            <rect width={W} height={GROUND} fill="#fff" />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <rect key={i} y={262 + i * 22 + i * i} width={W} height={3 + i * 1.6} fill="#000" />
            ))}
          </mask>
        </defs>
        <ellipse cx="1060" cy="300" rx="520" ry="260" fill="url(#city-glow)" />
        {/* Mount Fuji with its snow cap, far behind. */}
        <path d="M120 400L470 196Q500 180 530 196L880 400Z" fill="url(#city-fuji)" />
        <path d="M430 220L470 196Q500 180 530 196L572 220L548 214L528 228L506 212L486 230L462 214Z" fill="#cfc8ff" opacity="0.55" />
        <circle cx="1060" cy="300" r="150" fill="url(#city-sun)" mask="url(#city-sun-cut)" />
        {/* The far city in the haze. */}
        <g fill="#191540">
          {far.map((b, index) => (
            <path key={index} d={outline(b)} />
          ))}
        </g>
        <path d={farA} fill="#35e6ff" opacity="0.35" />
        <path d={farB} fill="#ff5ccd" opacity="0.35" />
        <path d={farC} fill="#ffc46b" opacity="0.3" />
        <rect y="200" width={W} height="200" fill="url(#city-haze)" />
        {/* Tokyo Tower. */}
        <path className="city-tower" d={towerPath(towerX, GROUND, 250)} fill="none" stroke="#ff7a45" strokeWidth="2.2" />
        <rect x={towerX - 16} y="232" width="32" height="9" rx="2" fill="#ff9a5c" />
        <rect x={towerX - 9} y="178" width="18" height="6" rx="2" fill="#ffc46b" />
        <circle className="city-beacon" cx={towerX} cy="148" r="3.5" fill="#ff3b5c" />
        {/* The near city: dark, with neon rims on the roofs. */}
        <g fill="#0a0b1e">
          {near.map((b, index) => (
            <path key={index} d={outline(b)} />
          ))}
        </g>
        <g fill="none" strokeWidth="1.4" opacity="0.75">
          {near.map((b, index) => (
            <path key={index} d={outline(b).replace(/V400Z$/, '').replace(/^M[-\d.]+ 400V/, `M${b.x} `)} stroke={index % 4 === 0 ? '#ff5ccd' : index % 4 === 2 ? '#35e6ff' : 'none'} />
          ))}
        </g>
        <path className="city-windows" d={nearA} fill="#8ff0ff" opacity="0.75" />
        <path className="city-windows-alt" d={nearB} fill="#ffc46b" opacity="0.7" />
        <path d={nearC} fill="#ff8fe0" opacity="0.7" />
        {signs.map((sign, index) => (
          <rect
            key={index}
            className={`city-sign city-sign-${index % 3}`}
            x={sign.x}
            y={sign.y}
            width="7"
            height={sign.h}
            rx="2"
            fill="none"
            stroke={['#ff5ccd', '#35e6ff', '#ffc46b'][sign.tone]}
            strokeWidth="2"
          />
        ))}
        {/* The horizon line where the floor begins. */}
        <rect y={GROUND - 2} width={W} height="2" fill="#ff5ccd" opacity="0.8" />
      </svg>
      <div className="city-floor" />
    </div>
  );
});
