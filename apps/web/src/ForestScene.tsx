import { memo } from 'react';
import { useThemeMode } from './theme.ts';

/**
 * The forest at night behind every page in the Witch Forest preset (25.1): a pale moon behind drifting
 * cloud, ridges of pines fading into mist, a crooked hut with one candlelit window, gnarled old trees at the
 * edges, a crow, fireflies, and ivy hanging from the top corners. Pure decoration
 * (aria-hidden, no pointer events), rendered only while the preset is chosen. Its motion (fog, fireflies,
 * smoke, the candle, the swaying ivy) lives in witch-forest.css and stops under prefers-reduced-motion.
 */
export function ForestScene() {
  const [mode] = useThemeMode();
  if (mode !== 'witch-forest') return null;
  return <Forest />;
}

const W = 1600;
const H = 720;

/** A small seeded random generator, so the forest is the same on every visit and every device. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const r1 = (value: number): number => Math.round(value * 10) / 10;

/** One pine: a trunk and jagged tiers of branches, narrowing to a crooked tip. */
function pine(random: () => number, x: number, base: number, height: number, width: number): string {
  const tiers = 7 + Math.floor(random() * 4);
  const top = base - height;
  const lean = (random() - 0.5) * width * 0.25;
  // Points up the left side (bottom to top) and up the right side; the right is walked back down.
  const left: string[] = [];
  const right: string[] = [];
  for (let i = 0; i < tiers; i += 1) {
    const share = i / tiers;
    const y = base - height * 0.12 - share * height * 0.86;
    const half = (width / 2) * (1 - share) ** 0.85 * (0.8 + random() * 0.35);
    const cx = x + lean * share;
    const droop = 4 + random() * 6;
    const notch = y - height / tiers / 2;
    left.push(`L${r1(cx - half)} ${r1(y + droop)}`, `L${r1(cx - half * 0.3)} ${r1(notch)}`);
    right.push(`L${r1(cx + half)} ${r1(y + droop + (random() - 0.5) * 3)}`, `L${r1(cx + half * 0.3)} ${r1(notch)}`);
  }
  // The right side mirrors the left: collected bottom-up, walked top-down from the tip.
  const down = [...right].reverse();
  const trunk = Math.max(2, width * 0.06);
  return `M${r1(x - trunk)} ${base}L${r1(x - trunk)} ${r1(base - height * 0.1)}${left.join('')}L${r1(x + lean)} ${r1(top)}${down.join('')}L${r1(x + trunk)} ${r1(base - height * 0.1)}L${r1(x + trunk)} ${base}Z`;
}

interface Gnarled {
  /** One path per branch generation (thick to thin), so each can have its own stroke width. */
  readonly limbs: string[];
  readonly widths: number[];
  /** Where a crow could sit: the end of a level branch. */
  readonly perch: { x: number; y: number } | null;
  readonly roots: string;
}

/**
 * An old gnarled tree, grown from one trunk: each branch bends a little and splits in two or three, the
 * angles wander, and the last twigs are hair-thin. `lean` tips the whole tree (radians, + = right).
 */
function gnarled(random: () => number, x: number, base: number, height: number, lean: number, depth = 7): Gnarled {
  const limbs = Array.from({ length: depth + 1 }, () => '');
  const trunkWidth = height / 13;
  const widths = limbs.map((_, level) => r1(Math.max(0.6, trunkWidth * 0.62 ** level)));
  let perch: Gnarled['perch'] = null;
  const grow = (sx: number, sy: number, angle: number, length: number, level: number): void => {
    const ex = sx + Math.sin(angle) * length;
    const ey = sy - Math.cos(angle) * length;
    const bend = (random() - 0.5) * length * 0.45;
    const cx = (sx + ex) / 2 + Math.cos(angle) * bend;
    const cy = (sy + ey) / 2 + Math.sin(angle) * bend;
    limbs[level] += `M${r1(sx)} ${r1(sy)}Q${r1(cx)} ${r1(cy)} ${r1(ex)} ${r1(ey)}`;
    if (perch === null && level === 3 && Math.abs(angle) > 0.9 && Math.abs(angle) < 1.5 && ey < base - height * 0.55) perch = { x: r1(ex), y: r1(ey) };
    if (level >= depth) return;
    const children = level < 2 ? 2 + (random() < 0.5 ? 1 : 0) : 2;
    for (let child = 0; child < children; child += 1) {
      const spread = (child - (children - 1) / 2) * (0.55 + random() * 0.35);
      // Branches bend back up towards the light, and a little outward.
      const next = angle + spread + (random() - 0.5) * 0.45 - angle * 0.12;
      grow(ex, ey, next, length * (0.66 + random() * 0.16), level + 1);
    }
  };
  grow(x, base, lean, height * 0.32, 0);
  // Roots: a few thick curves spreading over the ground.
  let roots = '';
  for (const side of [-1, -0.45, 0.4, 1]) {
    const reach = trunkWidth * (1.6 + random() * 1.4);
    roots += `M${r1(x + side * trunkWidth * 0.3)} ${r1(base - trunkWidth * 0.9)}Q${r1(x + side * reach * 0.6)} ${r1(base - trunkWidth * 0.2)} ${r1(x + side * reach)} ${base + 4}`;
  }
  return { limbs, widths, perch, roots };
}

/** Grass and fern fronds along the bottom edge, as one path of thin curved blades. */
function undergrowth(random: () => number, ground: number): string {
  let d = '';
  for (let x = -10; x < W + 10; x += 5 + random() * 7) {
    const h = 10 + random() ** 2 * 46;
    const bend = (random() - 0.5) * h * 0.8;
    d += `M${r1(x)} ${ground + 2}q${r1(bend * 0.3)} ${r1(-h * 0.6)} ${r1(bend)} ${r1(-h)}`;
  }
  return d;
}

/** One fern: a curved stalk with leaflets on both sides, smaller towards the tip. */
function fern(random: () => number, x: number, ground: number, size: number, flip: number): string {
  let d = '';
  const steps = 10;
  let px = x;
  let py = ground;
  for (let i = 0; i < steps; i += 1) {
    const share = i / steps;
    const nx = px + flip * size * 0.07 * (0.4 + share);
    const ny = py - size * 0.085 * (1 - share * 0.35);
    d += `M${r1(px)} ${r1(py)}L${r1(nx)} ${r1(ny)}`;
    const leaf = size * 0.2 * (1 - share) + 2;
    d += `M${r1(nx)} ${r1(ny)}q${r1(-leaf * 0.6)} ${r1(-leaf * 0.1)} ${r1(-leaf)} ${r1(leaf * 0.35 + random() * 2)}`;
    d += `M${r1(nx)} ${r1(ny)}q${r1(leaf * 0.6)} ${r1(-leaf * 0.25)} ${r1(leaf)} ${r1(leaf * 0.15 + random() * 2)}`;
    px = nx;
    py = ny;
  }
  return d;
}

/** A smooth ridge line across the whole width, closed down to the bottom of the picture. */
function ridge(random: () => number, base: number, amplitude: number, points: number): string {
  let d = `M-20 ${H}L-20 ${base}`;
  let previous = base;
  for (let i = 0; i <= points; i += 1) {
    const x = -20 + ((W + 40) * i) / points;
    const y = base - random() * amplitude;
    d += `Q${r1(x - (W + 40) / points / 2)} ${r1((previous + y) / 2 - amplitude * 0.3 * random())} ${r1(x)} ${r1(y)}`;
    previous = y;
  }
  return `${d}L${W + 20} ${H}Z`;
}

/** An ivy leaf, pointing down, about 18 units long; reused with <use>. */
const LEAF = 'M0 0C-3 -1 -8 1 -9 6C-7 6 -6 7 -6 9C-4 8 -1 10 0 14C1 10 4 8 6 9C6 7 7 6 9 6C8 1 3 -1 0 0Z';

interface Vine {
  readonly stem: string;
  readonly leaves: { x: number; y: number; angle: number; scale: number; tone: number }[];
}

/** Ivy hanging from the top edge: a wavy stem with leaves on alternating sides. */
function vines(random: () => number, starts: readonly number[], maxLength: number): Vine[] {
  return starts.map((start, index) => {
    const length = maxLength * (0.45 + random() * 0.55) * (index % 3 === 1 ? 0.6 : 1);
    const sway = 6 + random() * 10;
    let stem = `M${start} -4`;
    const leaves: Vine['leaves'] = [];
    let previousX = start;
    for (let y = 18; y <= length; y += 18) {
      const x = start + Math.sin(y / 34 + index) * sway;
      stem += `Q${r1(previousX + (random() - 0.5) * 8)} ${r1(y - 9)} ${r1(x)} ${y}`;
      const side = (y / 18) % 2 === 0 ? 1 : -1;
      leaves.push({ x: r1(x + side * 3), y, angle: r1(side * (25 + random() * 35)), scale: r1(0.65 + random() * 0.6 * (1 - y / length / 2)), tone: random() < 0.3 ? 1 : 0 });
      previousX = x;
    }
    return { stem, leaves };
  });
}

/** The ivy in one top corner (mirrored for the right). */
function Ivy(props: { side: 'left' | 'right'; seed: number }) {
  const random = seeded(props.seed);
  const list = vines(random, [14, 46, 70, 104, 132, 170, 214, 260], 250);
  return (
    <svg className={`forest-ivy forest-ivy-${props.side}`} viewBox="0 0 300 270" preserveAspectRatio={props.side === 'left' ? 'xMinYMin meet' : 'xMaxYMin meet'} focusable="false">
      <g transform={props.side === 'right' ? 'translate(300 0) scale(-1 1)' : undefined}>
        {/* The branch they hang from, along the very top. */}
        <path d="M-10 4Q60 14 120 6T250 10T310 2" fill="none" stroke="#0d1a12" strokeWidth="7" strokeLinecap="round" />
        {list.map((vine, index) => (
          <g key={index} className={`forest-vine forest-vine-${index % 3}`}>
            <path d={vine.stem} fill="none" stroke="#1d3424" strokeWidth="1.6" strokeLinecap="round" />
            {vine.leaves.map((leaf, leafIndex) => (
              <use key={leafIndex} href="#forest-leaf" transform={`translate(${leaf.x} ${leaf.y}) rotate(${leaf.angle}) scale(${leaf.scale})`} fill={leaf.tone === 1 ? '#2f5137' : '#1f3b28'} />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}

/** Fireflies: where they float and how they pulse (set inline, so each has its own rhythm). */
function fireflies(random: () => number) {
  return Array.from({ length: 18 }, () => ({
    left: `${r1(4 + random() * 92)}%`,
    bottom: `${r1(4 + random() * 36)}vh`,
    animationDuration: `${r1(7 + random() * 9)}s, ${r1(2.6 + random() * 3)}s`,
    animationDelay: `${r1(-random() * 12)}s, ${r1(-random() * 4)}s`,
  }));
}

const Forest = memo(function Forest() {
  const random = seeded(20261023);
  const farRidge = ridge(random, 470, 70, 9);
  const farPines = Array.from({ length: 64 }, (_, index) => {
    const x = (index / 64) * W + random() * 22;
    return pine(random, r1(x), 500 + random() * 14, 46 + random() * 70, 20 + random() * 18);
  }).join('');
  const midRidge = ridge(random, 560, 34, 7);
  const midPines = Array.from({ length: 22 }, (_, index) => {
    const x = (index / 22) * W + random() * 40;
    // Leave the clearing around the hut open.
    if (Math.abs(x - 900) < 120) return '';
    return pine(random, r1(x), 586 + random() * 10, 120 + random() * 120, 46 + random() * 30);
  }).join('');
  const midTrees = [gnarled(random, 560, 590, 250, -0.12, 6), gnarled(random, 1230, 592, 230, 0.15, 6)];
  const left = gnarled(random, 70, 712, 640, 0.22);
  const right = gnarled(random, 1530, 712, 680, -0.2);
  const crow = right.perch ?? left.perch;
  const grass = undergrowth(random, 702);
  const ferns = [fern(random, 210, 712, 120, 1), fern(random, 230, 712, 90, -1), fern(random, 1340, 712, 130, -1), fern(random, 1320, 712, 96, 1), fern(random, 760, 712, 70, -1), fern(random, 1080, 712, 80, 1)].join('');
  const flies = fireflies(random);
  const tree = (t: Gnarled, colour: string, className?: string) => (
    <g className={className} fill="none" stroke={colour} strokeLinecap="round">
      <path d={t.roots} strokeWidth={t.widths[0] ?? 8} />
      {t.limbs.map((d, level) => (
        <path key={level} d={d} strokeWidth={t.widths[level]} />
      ))}
    </g>
  );
  return (
    <div className="forest" aria-hidden="true">
      <div className="forest-sky" />
      <div className="forest-moon">
        <svg viewBox="0 0 100 100" focusable="false">
          <defs>
            <radialGradient id="forest-moon-face" cx="0.42" cy="0.38" r="0.7">
              <stop offset="0" stopColor="#eef0dc" />
              <stop offset="0.7" stopColor="#cfd6bf" />
              <stop offset="1" stopColor="#a9b4a0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="30" fill="url(#forest-moon-face)" />
          {/* Maria: the darker plains of the moon. */}
          <g fill="#8e9a88" opacity="0.38">
            <ellipse cx="40" cy="40" rx="9" ry="7" />
            <ellipse cx="57" cy="36" rx="6" ry="5" />
            <ellipse cx="55" cy="56" rx="10" ry="7" />
            <ellipse cx="38" cy="61" rx="5" ry="4" />
            <circle cx="64" cy="66" r="2.4" />
            <circle cx="30" cy="50" r="2" />
          </g>
          <circle cx="50" cy="50" r="30" fill="none" stroke="#f4f6e6" strokeOpacity="0.5" strokeWidth="0.6" />
        </svg>
      </div>
      <div className="forest-cloud" />
      <svg className="forest-crow-flying" viewBox="0 0 60 24" focusable="false">
        <path d="M0 12Q12 2 24 10L30 12L36 10Q48 2 60 12Q48 8 38 14L33 15L30 18L27 15L22 14Q12 8 0 12Z" fill="#050907" />
      </svg>
      <svg className="forest-land" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" focusable="false">
        <defs>
          <linearGradient id="forest-mist" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#9fbcb0" stopOpacity="0" />
            <stop offset="1" stopColor="#9fbcb0" stopOpacity="0.16" />
          </linearGradient>
          <radialGradient id="forest-candle">
            <stop offset="0" stopColor="#f0d58a" stopOpacity="0.55" />
            <stop offset="1" stopColor="#f0d58a" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="forest-pumpkin" cx="0.4" cy="0.35" r="0.75">
            <stop offset="0" stopColor="#b8642a" />
            <stop offset="1" stopColor="#6e3412" />
          </radialGradient>
          <path id="forest-leaf" d={LEAF} />
          <filter id="forest-blur" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        {/* Far: a ridge and a line of pines, pale with distance. */}
        <path d={farRidge} fill="#13241e" />
        <path d={farPines} fill="#14271f" />
        <rect y="380" width={W} height="200" fill="url(#forest-mist)" />
        {/* Middle: pines, two old trees and the clearing with the hut. */}
        <path d={midRidge} fill="#0c1813" />
        <path d={midPines} fill="#0d1a14" />
        {midTrees.map((t, index) => (
          <g key={index}>{tree(t, '#0d1a14')}</g>
        ))}
        <g className="forest-hut">
          <path d="M836 600L834 540L962 534L966 600Z" fill="#0a1510" />
          {/* Weathered planks. */}
          <path d="M836 556L964 550M836 572L965 566M836 588L966 583" stroke="#14231b" strokeWidth="1.2" />
          {/* The window: candlelight behind small panes. */}
          <ellipse className="forest-candle-glow" cx="866" cy="560" rx="46" ry="34" fill="url(#forest-candle)" />
          <rect className="forest-candle" x="855" y="550" width="22" height="20" rx="1" fill="#e7c470" />
          <path d="M866 550V570M855 560H877" stroke="#0a1510" strokeWidth="2" />
          <path d="M853 548H879V572H853Z" fill="none" stroke="#050a07" strokeWidth="2.5" />
          {/* The door with a thread of light along its edge. */}
          <path d="M910 600V566Q922 552 934 566V600Z" fill="#040806" />
          <path d="M933 568V599" stroke="#e7c470" strokeOpacity="0.45" strokeWidth="1" />
          {/* A steep, sagging roof with rows of shingles and a crooked tip. */}
          <path d="M818 548Q850 520 884 472Q896 452 902 444Q906 470 930 500Q956 528 988 540L978 548Q948 534 924 510Q904 490 900 470Q886 500 856 530Q840 546 826 556Z" fill="#070e0a" />
          <path d="M844 532Q872 504 892 476M864 536Q888 508 900 486M940 520Q918 498 906 476M962 534Q934 512 914 486" stroke="#15241c" strokeWidth="1.2" fill="none" />
          <path d="M902 444Q912 432 926 434" stroke="#070e0a" strokeWidth="3" fill="none" strokeLinecap="round" />
          {/* Chimney and its smoke. */}
          <path d="M938 512L936 470L952 468L954 520Z" fill="#070e0a" />
          <g className="forest-smoke" fill="#a9bdb3" filter="url(#forest-blur)">
            <circle cx="945" cy="458" r="8" opacity="0.13" />
            <circle cx="948" cy="444" r="10" opacity="0.1" />
            <circle cx="946" cy="428" r="12" opacity="0.08" />
            <circle cx="952" cy="410" r="15" opacity="0.06" />
            <circle cx="958" cy="390" r="19" opacity="0.04" />
          </g>
          {/* One pumpkin by the door, the only orange in the forest. */}
          <g transform="translate(948 590)">
            <ellipse cx="0" cy="2" rx="13" ry="9" fill="url(#forest-pumpkin)" />
            <path d="M-6 -6Q-9 2 -6 10M0 -7V11M6 -6Q9 2 6 10" stroke="#5a2a0e" strokeWidth="1.1" fill="none" />
            <path d="M0 -7Q1 -12 4 -13" stroke="#2c3a1c" strokeWidth="2" fill="none" strokeLinecap="round" />
          </g>
          {/* A tiny pumpkin leaf curling beside it. */}
          <path d="M960 596q8 -10 14 -2q-6 2 -14 2z" fill="#1f3b28" />
        </g>
        <rect y="520" width={W} height="200" fill="url(#forest-mist)" />
        {/* Near: the two great trees at the edges, a crow, ferns and grass. */}
        {tree(left, '#040907', 'forest-tree-left')}
        {tree(right, '#040907', 'forest-tree-right')}
        {crow !== null && (
          <g transform={`translate(${crow.x} ${crow.y - 2})`}>
            <path d="M-12 0Q-10 -10 -2 -12Q3 -18 8 -15L13 -14L8 -12Q9 -6 4 -2L6 0L-4 0Q-9 2 -18 6Q-14 2 -12 0Z" fill="#020504" />
            <circle className="forest-crow-eye" cx="7" cy="-15" r="0.9" fill="#c9d3c0" />
          </g>
        )}
        <path d={`M-20 ${H}L-20 704Q300 690 600 702T1200 698T1620 704L1620 ${H}Z`} fill="#030705" />
        <path d={grass} fill="none" stroke="#08130d" strokeWidth="1.6" strokeLinecap="round" />
        <path d={ferns} fill="none" stroke="#0f2117" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <div className="forest-fog forest-fog-far" />
      <div className="forest-fog forest-fog-near" />
      <div className="forest-fireflies">
        {flies.map((style, index) => (
          <span key={index} style={style} />
        ))}
      </div>
      <Ivy side="left" seed={7} />
      <Ivy side="right" seed={11} />
    </div>
  );
});
