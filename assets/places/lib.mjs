/**
 * Drawing helpers for the Places artwork (section 30). Everything is deterministic (seeded), so the
 * same source always renders the same pictures. The output is plain SVG that render.mjs rasterises
 * once into WebP files; nothing of this runs in the app.
 */

export function rng(seed) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + next() * (b - a);
  next.int = (a, b) => Math.floor(a + next() * (b - a + 1));
  next.pick = (list) => list[Math.floor(next() * list.length)];
  next.chance = (p) => next() < p;
  return next;
}

const clamp = (v, a = 0, b = 255) => Math.max(a, Math.min(b, v));
export function hex(c) {
  const v = c.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}
export function toHex([r, g, b]) {
  return `#${[r, g, b].map((x) => Math.round(clamp(x)).toString(16).padStart(2, '0')).join('')}`;
}
/** Mix two colours (t = 0 → a, 1 → b). */
export function mix(a, b, t) {
  const x = hex(a);
  const y = hex(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}
/** Lighten (amount > 0) or darken (< 0) by mixing with white/black. */
export function shade(c, amount) {
  return amount >= 0 ? mix(c, '#ffffff', amount) : mix(c, '#000000', -amount);
}
/** A small random variation of a colour (for bricks, stones, leaves). */
export function jitter(c, random, spread = 0.08) {
  const [r, g, b] = hex(c);
  const k = 1 + (random() - 0.5) * 2 * spread;
  const w = (random() - 0.5) * spread * 40;
  return toHex([r * k + w, g * k + w * 0.8, b * k + w * 0.6]);
}

export const f = (n) => Math.round(n * 10) / 10;

export class Svg {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.defs = [];
    this.body = [];
    this.ids = 0;
  }
  id(prefix = 'g') {
    this.ids += 1;
    return `${prefix}${this.ids}`;
  }
  def(markup) {
    this.defs.push(markup);
  }
  add(markup) {
    this.body.push(markup);
    return this;
  }
  /** Vertical/horizontal linear gradient; stops: [[offset, colour, opacity?], …]. */
  linear(stops, { x1 = 0, y1 = 0, x2 = 0, y2 = 1, units } = {}) {
    const id = this.id('lg');
    const u = units === undefined ? '' : ` gradientUnits="${units}"`;
    this.def(`<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${u}>${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</linearGradient>`);
    return `url(#${id})`;
  }
  radial(stops, { cx = 0.5, cy = 0.5, r = 0.5, fx, fy, units } = {}) {
    const id = this.id('rg');
    const u = units === undefined ? '' : ` gradientUnits="${units}"`;
    this.def(`<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}"${fx === undefined ? '' : ` fx="${fx}" fy="${fy}"`}${u}>${stops.map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join('')}</radialGradient>`);
    return `url(#${id})`;
  }
  toString() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}"><defs>${this.defs.join('')}</defs>${this.body.join('')}</svg>`;
  }
}

/** Common filters: fine grain, large stains, painterly wobble of edges, soft blur. */
export function filters(svg, seed) {
  svg.def(`<filter id="grain" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">
    <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="${seed}" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 1.4 -0.55" result="g"/>
    <feComposite in="g" in2="SourceGraphic" operator="in" result="gm"/>
    <feBlend in="SourceGraphic" in2="gm" mode="overlay"/>
  </filter>`);
  // Weathering: large soft blotches darken and lighten the plaster.
  svg.def(`<filter id="stains" x="0" y="0" width="100%" height="100%" filterUnits="objectBoundingBox">
    <feTurbulence type="fractalNoise" baseFrequency="0.004 0.012" numOctaves="4" seed="${seed + 3}" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.16  0 0 0 0 0.12  0 0 0 0 0.08  0 0 0 1.5 -0.64" result="s"/>
    <feComposite in="s" in2="SourceGraphic" operator="in" result="sm"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.05 0.2" numOctaves="3" seed="${seed + 5}" result="n2"/>
    <feColorMatrix in="n2" type="matrix" values="0 0 0 0 1  0 0 0 0 0.97  0 0 0 0 0.9  0 0 0 1.1 -0.8" result="l"/>
    <feComposite in="l" in2="SourceGraphic" operator="in" result="lm"/>
    <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="sm"/><feMergeNode in="lm"/></feMerge>
  </filter>`);
  svg.def(`<filter id="wobble" x="-2%" y="-2%" width="104%" height="104%">
    <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="${seed + 7}" result="w"/>
    <feDisplacementMap in="SourceGraphic" in2="w" scale="3.2" xChannelSelector="R" yChannelSelector="G"/>
  </filter>`);
  // Brush: a gentle displacement and an even canvas texture for the painterly finish over everything.
  svg.def(`<filter id="brush" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">
    <feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" seed="${seed + 11}" result="w"/>
    <feDisplacementMap in="SourceGraphic" in2="w" scale="4" xChannelSelector="R" yChannelSelector="G" result="d"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.035 0.05" numOctaves="2" seed="${seed + 13}" result="s"/>
    <feColorMatrix in="s" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.32 -0.08" result="sa"/>
    <feComposite in="sa" in2="d" operator="in" result="sm"/>
    <feBlend in="d" in2="sm" mode="soft-light"/>
  </filter>`);
  for (const r of [2, 6, 14, 30, 60]) svg.def(`<filter id="blur${r}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${r}"/></filter>`);
}

/** Many small rectangles (bricks or ashlar stones) with mortar, each slightly different. */
export function masonry(svg, random, { x, y, w, h, unitW, unitH, mortar, colours, spread = 0.08, offset = 0.5, rough = 0 }) {
  const parts = [`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${mortar}"/>`];
  const gap = Math.max(1, unitH * 0.12);
  let row = 0;
  for (let yy = y; yy < y + h; yy += unitH, row++) {
    const shift = row % 2 === 0 ? 0 : -unitW * offset;
    for (let xx = x + shift; xx < x + w; xx += unitW) {
      const ww = Math.min(unitW - gap, x + w - xx - gap);
      const x0 = Math.max(x, xx);
      const wcut = ww - (x0 - xx);
      if (wcut <= 1) continue;
      const hh = Math.min(unitH - gap, y + h - yy);
      if (hh <= 1) continue;
      const c = jitter(random.pick(colours), random, spread);
      const r = rough > 0 ? random.range(0, rough) : 0;
      parts.push(`<rect x="${f(x0)}" y="${f(yy)}" width="${f(wcut)}" height="${f(hh)}" rx="${f(r)}" fill="${c}"/>`);
    }
  }
  return `<g>${parts.join('')}</g>`;
}

/** Ivy: branching stems from a root, with leaves of varied size, angle and tone. */
export function ivy(random, { x, y, height, spread, leaf = 14, tones, density = 1, up = true, stem = '#3b3324', reach = 1 }) {
  const stems = [];
  const leaves = [];
  const grow = (sx, sy, length, angle, depth) => {
    let px = sx;
    let py = sy;
    let a = angle;
    const steps = Math.round(length / 12);
    const path = [`M${f(px)} ${f(py)}`];
    for (let i = 0; i < steps; i++) {
      a += random.range(-0.35, 0.35);
      // Ivy climbs: pull the direction back toward the vertical.
      a = a * 0.86 + (up ? -Math.PI / 2 : Math.PI / 2) * 0.14;
      px += Math.cos(a) * 12;
      py += Math.sin(a) * 12;
      if (Math.abs(px - x) > spread) a += px > x ? -0.5 : 0.5;
      path.push(`L${f(px)} ${f(py)}`);
      const n = random() < 0.7 * density ? random.int(1, 3) : 0;
      for (let k = 0; k < n; k++) {
        const size = leaf * random.range(0.55, 1.25) * (1 - depth * 0.12);
        const lx = px + random.range(-size, size);
        const ly = py + random.range(-size * 0.8, size * 0.8);
        leaves.push({ x: lx, y: ly, size, rot: random.range(-60, 60) + (lx < px ? -30 : 30), tone: random.pick(tones), light: random() });
      }
      if (depth < 3 && random() < 0.07 * reach) grow(px, py, length * random.range(0.25, 0.6), a + random.pick([-1, 1]) * random.range(0.6, 1.3), depth + 1);
    }
    stems.push(`<path d="${path.join('')}" stroke="${stem}" stroke-width="${f(3 - depth * 0.6)}" fill="none" stroke-linecap="round" opacity="0.85"/>`);
  };
  const trunks = Math.max(1, Math.round(spread / 90));
  for (let i = 0; i < trunks; i++) grow(x + random.range(-spread * 0.3, spread * 0.3), y, height * random.range(0.6, 1), up ? -Math.PI / 2 : Math.PI / 2, 0);
  leaves.sort((a, b) => a.light - b.light);
  const leafPath = (s) => `M0 ${f(s * 0.55)}C${f(-s * 0.15)} ${f(s * 0.3)} ${f(-s * 0.75)} ${f(s * 0.15)} ${f(-s * 0.6)} ${f(-s * 0.25)}C${f(-s * 0.4)} ${f(-s * 0.55)} ${f(-s * 0.15)} ${f(-s * 0.35)} 0 ${f(-s * 0.7)}C${f(s * 0.15)} ${f(-s * 0.35)} ${f(s * 0.4)} ${f(-s * 0.55)} ${f(s * 0.6)} ${f(-s * 0.25)}C${f(s * 0.75)} ${f(s * 0.15)} ${f(s * 0.15)} ${f(s * 0.3)} 0 ${f(s * 0.55)}Z`;
  const leafMarkup = leaves.map((l) => {
    const c = l.light > 0.82 ? shade(l.tone, 0.18) : l.light < 0.25 ? shade(l.tone, -0.3) : l.tone;
    return `<path transform="translate(${f(l.x)} ${f(l.y)}) rotate(${f(l.rot)})" d="${leafPath(l.size)}" fill="${c}"/>`;
  });
  return `<g>${stems.join('')}${leafMarkup.join('')}</g>`;
}

/** A soft drop shadow band under a projecting element (cornice, sill, balcony). */
export function castShadow(svg, { x, y, w, h, opacity = 0.35, colour = '#000000', dx = 10 }) {
  const fill = svg.linear([[0, colour, opacity], [1, colour, 0]]);
  return `<path d="M${f(x)} ${f(y)}H${f(x + w)}L${f(x + w + dx)} ${f(y + h)}H${f(x + dx)}Z" fill="${fill}"/>`;
}

/**
 * Glass of one pane: dark, with a faint reflection of the sky and, sometimes, the shape of a curtain.
 * Returns markup; pushes the pane into `lights` when it is lit at night.
 */
export function pane(svg, random, { x, y, w, h, glass, sky, curtain, lit, lights }) {
  const fill = svg.linear([[0, mix(glass, sky, 0.45)], [0.45, glass], [1, shade(glass, -0.35)]], { x1: 0, y1: 0, x2: 0.4, y2: 1 });
  const parts = [`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" fill="${fill}"/>`];
  // A diagonal glint.
  if (random() < 0.6) parts.push(`<path d="M${f(x)} ${f(y + h * 0.35)}L${f(x + w * 0.55)} ${f(y)}L${f(x + w * 0.8)} ${f(y)}L${f(x)} ${f(y + h * 0.6)}Z" fill="#ffffff" opacity="${f(random.range(0.03, 0.09) * 100) / 100}"/>`);
  if (curtain !== undefined && random() < 0.55) {
    // A drape hanging at one side, gathered a little: soft folds, half transparent like old voile.
    const side = random() < 0.5;
    const cw = w * random.range(0.22, 0.38);
    const cx = side ? x : x + w - cw;
    const fold = svg.linear([[0, curtain, 0.75], [0.35, shade(curtain, -0.18), 0.6], [0.6, curtain, 0.7], [1, shade(curtain, -0.22), 0.55]], { x1: 0, y1: 0, x2: 1, y2: 0 });
    const inner = side ? cx + cw : cx;
    const tuck = side ? inner - cw * 0.25 : inner + cw * 0.25;
    parts.push(`<path d="M${f(cx)} ${f(y)}H${f(cx + cw)}${side ? `Q${f(tuck)} ${f(y + h * 0.55)} ${f(inner)} ${f(y + h)}H${f(cx)}` : `V${f(y + h)}H${f(inner)}Q${f(tuck)} ${f(y + h * 0.55)} ${f(cx)} ${f(y)}`}Z" fill="${fold}"/>`);
  }
  if (lit) lights.push({ x, y, w, h });
  return parts.join('');
}

/** The lights layer: warm glow of lit panes, a soft bloom around them. */
export function lightsLayer(width, height, lights, warm = '#ffcf7d') {
  const svg = new Svg(width, height);
  const glow = svg.linear([[0, shade(warm, 0.35)], [0.6, warm], [1, shade(warm, -0.25)]]);
  svg.def(`<filter id="bloom" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="22"/></filter>`);
  const bloom = lights.map((l) => `<rect x="${f(l.x - l.w * 0.2)}" y="${f(l.y - l.h * 0.1)}" width="${f(l.w * 1.4)}" height="${f(l.h * 1.2)}" fill="${warm}" opacity="0.32"/>`).join('');
  const panes = lights.map((l) => `<rect x="${f(l.x)}" y="${f(l.y)}" width="${f(l.w)}" height="${f(l.h)}" fill="${glow}" opacity="0.92"/>`).join('');
  svg.add(`<g filter="url(#bloom)">${bloom}</g>${panes}`);
  return svg;
}

/** A mass of foliage (a street tree's crown): clusters of leaves around a centre, darker inside. */
export function foliage(random, { cx, cy, rx, ry, tones, leaf = 18, count = 900, lit = '#c9b26a', litSide = -1 }) {
  const leaves = [];
  for (let i = 0; i < count; i++) {
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(random());
    const x = cx + Math.cos(a) * rx * r;
    const y = cy + Math.sin(a) * ry * r;
    const edge = r;
    // Leaves toward the light side, near the edge, catch the sun.
    const sun = Math.max(0, (Math.cos(a) * litSide * -1 + -Math.sin(a)) * 0.5) * edge;
    const base = random.pick(tones);
    const tone = sun > 0.45 && random() < 0.6 ? mix(base, lit, 0.35 + random() * 0.25) : shade(base, -0.35 * (1 - edge) - random() * 0.15);
    leaves.push({ x, y, s: leaf * random.range(0.6, 1.3), rot: random.range(0, 360), tone, depth: sun + random() * 0.3 });
  }
  leaves.sort((a, b) => a.depth - b.depth);
  const linden = (s) => `M0 ${f(-s * 0.6)}C${f(s * 0.55)} ${f(-s * 0.6)} ${f(s * 0.7)} ${f(s * 0.1)} 0 ${f(s * 0.6)}C${f(-s * 0.7)} ${f(s * 0.1)} ${f(-s * 0.55)} ${f(-s * 0.6)} 0 ${f(-s * 0.6)}Z`;
  return leaves.map((l) => `<path transform="translate(${f(l.x)} ${f(l.y)}) rotate(${f(l.rot)})" d="${linden(l.s)}" fill="${l.tone}"/>`).join('');
}

/** A soft-edged shadow polygon laid over the scene (multiply-like: dark, cool, translucent). */
export function shadowShape(points, { colour = '#1c2230', opacity = 0.42, blur = 14 } = {}) {
  return `<path d="M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join('L')}Z" fill="${colour}" opacity="${opacity}" filter="url(#blur${blur})" style="mix-blend-mode:multiply"/>`;
}
