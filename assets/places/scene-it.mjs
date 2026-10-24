/**
 * Italy — a Ligurian townhouse in a narrow lane: weathered plaster in faded terracotta and ochre with
 * painted window frames (the Ligurian trompe-l'œil), green louvered shutters half open, small iron
 * balconies with pots, a slate-grey stone door frame, terracotta roof tiles, jasmine climbing, a
 * glimpse of the hillside behind. Lived-in and quiet; no postcard sunshine.
 */
import { Svg, castShadow, f, filters, foliage, ivy, jitter, mix, pane, rng, shade, shadowShape } from './lib.mjs';

export function scene() {
  const W = 2400;
  const H = 1600;
  const random = rng(1861);
  const svg = new Svg(W, H);
  filters(svg, 47);
  const lights = [];

  const sky = '#cfc7b4';
  const glass = '#2b2e2a';
  const shutter = '#4f6a4a';
  const stone = '#7f7c74';
  const iron = '#2a2a27';

  // ---- Sky with high hazy cloud, and the green hillside with tiny distant houses.
  svg.def(`<filter id="clouds" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">
    <feTurbulence type="fractalNoise" baseFrequency="0.0014 0.005" numOctaves="5" seed="21" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.97  0 0 0 0 0.93  0 0 0 0 0.86  0 0 0 2.2 -1.0"/>
  </filter>`);
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="${H + 120}" fill="${svg.linear([[0, '#9fa7a6'], [0.5, sky], [1, '#e2d2b2']])}"/>`);
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="600" filter="url(#clouds)" opacity="0.75"/>`);
  {
    const hill = [];
    hill.push(`<path d="M-60 520C300 380 700 420 1000 350C1400 260 1800 330 2460 240V900H-60Z" fill="${mix('#6f7d5a', sky, 0.5)}"/>`);
    for (let i = 0; i < 60; i++) {
      const x = random.range(-40, 2440);
      const y = 430 - (x / 2400) * 160 + random.range(10, 120);
      hill.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(random.range(16, 34))}" height="${f(random.range(12, 22))}" fill="${mix(random.pick(['#d9b48a', '#e2c89a', '#c98f6c', '#ddd3bd']), sky, 0.45)}"/>`);
    }
    hill.push(foliage(random, { cx: 1200, cy: 560, rx: 1500, ry: 140, tones: [mix('#55653f', sky, 0.4), mix('#46553a', sky, 0.4)], leaf: 22, count: 700, lit: mix('#c9bf86', sky, 0.3) }));
    svg.add(`<g filter="url(#blur2)">${hill.join('')}</g>`);
  }

  // ---- Neighbours close on both sides (a carruggio): faded pink left, pale ochre right.
  const flatHouse = (x, w, top, wall, seed) => {
    const r = rng(seed);
    const p = [`<rect x="${x}" y="${top}" width="${w}" height="${H - top + 60}" fill="${wall}" filter="url(#stains)"/>`];
    p.push(`<path d="M${x - 20} ${top}H${x + w + 20}L${x + w} ${top - 30}H${x}Z" fill="#9b5b3e"/>`);
    for (let row = 0; row < 5; row++) {
      for (let c = 0; c < Math.floor(w / 230); c++) {
        const wx = x + 70 + c * 230;
        const wy = top + 80 + row * 250;
        if (wy > 1220) continue;
        p.push(`<rect x="${wx - 14}" y="${wy - 14}" width="128" height="208" fill="${shade(wall, 0.15)}"/>`);
        p.push(`<rect x="${wx}" y="${wy}" width="100" height="180" fill="${shade(shutter, r.range(-0.1, 0.1))}"/>`);
        for (let s = wy + 8; s < wy + 175; s += 9) p.push(`<rect x="${wx + 4}" y="${s}" width="92" height="3" fill="${shade(shutter, -0.3)}"/>`);
        p.push(`<rect x="${wx + 48}" y="${wy}" width="4" height="180" fill="${shade(shutter, -0.4)}"/>`);
      }
    }
    return `<g filter="url(#wobble)" opacity="0.92">${p.join('')}</g>`;
  };
  svg.add(flatHouse(-60, 600, 330, mix('#c9958a', sky, 0.25), 3));
  svg.add(flatHouse(1880, 600, 300, mix('#d8b67e', sky, 0.25), 4));
  svg.add(`<rect x="520" y="0" width="60" height="${H}" fill="#1b140f" opacity="0.28" filter="url(#blur14)"/>`);
  svg.add(`<rect x="1860" y="0" width="40" height="${H}" fill="#1b140f" opacity="0.28" filter="url(#blur14)"/>`);

  // ---- Main house: four storeys of faded terracotta plaster with painted frames and cornerstones.
  const X0 = 560;
  const X1 = 1880;
  const FW = X1 - X0;
  const ground = 1460;
  const roof = 250;
  const wall = '#b4806a';
  const h = [];
  // Roof: projecting eaves, terracotta coppi in rows.
  h.push(`<path d="M${X0 - 50} ${roof}L${X0 - 10} ${roof - 120}H${X1 + 10}L${X1 + 50} ${roof}Z" fill="#8e4a31"/>`);
  for (let y = roof - 112; y < roof - 6; y += 16) for (let x = X0 - 40; x < X1 + 40; x += 22) h.push(`<path d="M${f(x)} ${y + 16}q11 -18 22 0z" fill="${jitter('#9a5b42', random, 0.1)}"/>`);
  h.push(`<path d="M${X0 - 50} ${roof}L${X0 - 10} ${roof - 120}H${X1 + 10}L${X1 + 50} ${roof}Z" fill="${svg.linear([[0, '#2a1a12', 0.05], [1, '#2a1a12', 0.4]])}"/>`);
  h.push(`<rect x="${X0 - 60}" y="${roof - 6}" width="${FW + 120}" height="22" fill="#6e3826"/>`);
  for (let x = X0 - 50; x < X1 + 50; x += 40) h.push(`<rect x="${x}" y="${roof + 14}" width="16" height="22" fill="#5a2e1f"/>`);
  h.push(castShadow(svg, { x: X0, y: roof + 16, w: FW, h: 90, opacity: 0.45 }));
  // Wall.
  h.push(`<rect x="${X0}" y="${roof + 16}" width="${FW}" height="${ground - roof - 16}" fill="${svg.linear([[0, shade(wall, 0.12)], [0.6, wall], [1, shade(wall, -0.12)]], { x1: 0, y1: 0, x2: 0.35, y2: 1 })}" filter="url(#stains)"/>`);
  // Patches where the plaster fell off and shows stone.
  for (let i = 0; i < 9; i++) {
    const px = random.range(X0 + 40, X1 - 120);
    const py = random.range(roof + 80, ground - 120);
    const pw = random.range(40, 120);
    const ph = random.range(26, 70);
    h.push(`<path d="M${f(px)} ${f(py)}q${f(pw * 0.3)} -${f(ph * 0.4)} ${f(pw)} 0q${f(pw * 0.2)} ${f(ph * 0.6)} -${f(pw * 0.2)} ${f(ph)}q-${f(pw * 0.5)} ${f(ph * 0.2)} -${f(pw * 0.8)} 0z" fill="${shade('#a59b8a', random.range(-0.1, 0.1))}" opacity="0.8"/>`);
  }
  // Painted cornerstones (trompe-l'œil quoins) and a painted string course.
  const paint = '#e7d3b0';
  for (const qx of [X0, X1 - 70]) for (let y = roof + 30, i = 0; y < ground - 40; y += 56, i++) h.push(`<rect x="${qx + (i % 2) * 14}" y="${y}" width="${56 - (i % 2) * 14}" height="50" fill="${paint}" opacity="0.75"/><rect x="${qx + (i % 2) * 14}" y="${y + 46}" width="${56 - (i % 2) * 14}" height="4" fill="${shade(wall, -0.3)}" opacity="0.5"/>`);
  const floorTops = [1130, 860, 600, 360];
  for (const top of floorTops.slice(0, 3)) h.push(`<rect x="${X0}" y="${top - 20}" width="${FW}" height="16" fill="${paint}" opacity="0.6"/><rect x="${X0}" y="${top - 4}" width="${FW}" height="5" fill="${shade(wall, -0.35)}" opacity="0.45"/>`);

  // Windows: four axes, each with a painted frame and pediment, green persiane in different states.
  const axes = 4;
  const step = FW / axes;
  const curtain = '#efe5d2';
  const windowAt = (cx, top, height, floor, axis) => {
    const w = 120;
    const x = cx - w / 2;
    const out = [];
    // Painted frame with a painted pediment.
    out.push(`<rect x="${f(x - 30)}" y="${f(top - 30)}" width="${f(w + 60)}" height="${f(height + 50)}" fill="${paint}" opacity="0.8"/>`);
    out.push(`<path d="M${f(x - 44)} ${f(top - 30)}L${f(cx)} ${f(top - 78)}L${f(x + w + 44)} ${f(top - 30)}Z" fill="${paint}" opacity="0.8"/>`);
    out.push(`<path d="M${f(x - 44)} ${f(top - 30)}H${f(x + w + 44)}" stroke="${shade(wall, -0.35)}" stroke-width="4" opacity="0.5"/>`);
    out.push(`<rect x="${f(x - 30)}" y="${f(top + height + 8)}" width="${f(w + 60)}" height="12" fill="${shade(paint, -0.1)}"/>`);
    out.push(`<rect x="${f(x)}" y="${f(top)}" width="${w}" height="${height}" fill="#3a2f27"/>`);
    const state = (floor * 7 + axis * 3 + random.int(0, 3)) % 4; // 0 closed, 1 half, 2 open, 3 one leaf
    const lit = random.chance(0.3);
    if (state !== 0) {
      out.push(pane(svg, random, { x: x + 8, y: top + 8, w: w / 2 - 11, h: height - 16, glass, sky, curtain, lit, lights }));
      out.push(pane(svg, random, { x: x + w / 2 + 3, y: top + 8, w: w / 2 - 11, h: height - 16, glass, sky, curtain, lit, lights }));
      out.push(`<rect x="${f(x + w / 2 - 3)}" y="${f(top + 8)}" width="6" height="${height - 16}" fill="#e2d8c6"/>`);
    }
    const leaf = (lx, ly, lw, lh, angle) => {
      const p = [];
      const c = jitter(shutter, random, 0.06);
      p.push(`<rect x="${f(lx)}" y="${f(ly)}" width="${f(lw)}" height="${f(lh)}" fill="${c}"/>`);
      for (let s = ly + 10; s < ly + lh - 6; s += 10) p.push(`<rect x="${f(lx + 5)}" y="${f(s)}" width="${f(lw - 10)}" height="4" fill="${shade(c, -0.35)}"/>`);
      p.push(`<rect x="${f(lx)}" y="${f(ly)}" width="${f(lw)}" height="${f(lh)}" fill="none" stroke="${shade(c, -0.4)}" stroke-width="3"/>`);
      return angle ? `<g transform="skewY(${angle})" transform-origin="${f(lx)} ${f(ly)}">${p.join('')}</g>` : p.join('');
    };
    if (state === 0) {
      out.push(leaf(x, top, w / 2, height));
      out.push(leaf(x + w / 2, top, w / 2, height));
    } else if (state === 1) {
      out.push(leaf(x - w * 0.42, top, w * 0.42, height, -6));
      out.push(leaf(x + w, top, w * 0.42, height, 6));
    } else if (state === 2) {
      out.push(leaf(x - w / 2 - 8, top, w / 2, height));
      out.push(leaf(x + w + 8, top, w / 2, height));
    } else {
      out.push(leaf(x - w / 2 - 8, top, w / 2, height));
      out.push(leaf(x + w / 2, top, w / 2, height));
    }
    out.push(castShadow(svg, { x: x - 30, y: top + height + 20, w: w + 60, h: 26, opacity: 0.3 }));
    return out.join('');
  };
  const heights = [0, 200, 190, 170];
  for (let floor = 1; floor <= 3; floor++) {
    const top = floorTops[floor] + 70;
    for (let a = 0; a < axes; a++) h.push(windowAt(X0 + step * (a + 0.5), top, heights[floor], floor, a));
  }
  // Two small balconies with pots on the first floor.
  for (const a of [1, 2]) {
    const cx = X0 + step * (a + 0.5);
    const by = floorTops[1] + 70 + heights[1] + 6;
    const bw = 210;
    h.push(`<rect x="${f(cx - bw / 2)}" y="${f(by)}" width="${bw}" height="14" fill="${stone}"/>`);
    h.push(castShadow(svg, { x: cx - bw / 2, y: by + 14, w: bw, h: 40, opacity: 0.4 }));
    const rh = 70;
    h.push(`<rect x="${f(cx - bw / 2)}" y="${f(by - rh)}" width="${bw}" height="4" fill="${iron}"/>`);
    for (let x = cx - bw / 2 + 6; x < cx + bw / 2; x += 12) h.push(`<rect x="${f(x)}" y="${f(by - rh)}" width="2.5" height="${rh}" fill="${iron}"/>`);
    for (let i = 0; i < 3; i++) {
      const px = cx - bw / 2 + 20 + i * 64;
      h.push(`<path d="M${f(px)} ${f(by - 24)}h30l-4 22h-22z" fill="#a4573a"/>`);
      for (let k = 0; k < 18; k++) h.push(`<circle cx="${f(px + 15 + random.range(-18, 18))}" cy="${f(by - 30 - random.range(0, 30))}" r="${f(random.range(3, 7))}" fill="${random.chance(0.15) ? '#c9c2d6' : jitter('#5b6e3e', random, 0.15)}"/>`);
    }
  }
  // Ground floor: stone base, a slate door frame with a carved lintel, a small window with bars.
  h.push(`<rect x="${X0}" y="${ground - 90}" width="${FW}" height="90" fill="${shade(stone, 0.1)}" filter="url(#stains)"/>`);
  {
    const cx = X0 + step * 1.5;
    const dw = 170;
    const top = floorTops[0] + 70;
    h.push(`<rect x="${f(cx - dw / 2 - 34)}" y="${f(top - 40)}" width="${f(dw + 68)}" height="${f(ground - top + 40)}" fill="#5f5d59"/>`);
    h.push(`<rect x="${f(cx - dw / 2 - 40)}" y="${f(top - 60)}" width="${f(dw + 80)}" height="30" fill="#6d6a65"/>`);
    h.push(`<rect x="${f(cx - dw / 2)}" y="${f(top)}" width="${dw}" height="${f(ground - top)}" fill="#3c4a36"/>`);
    for (let y = top + 20; y < ground - 20; y += 60) h.push(`<rect x="${f(cx - dw / 2 + 14)}" y="${f(y)}" width="${f(dw - 28)}" height="44" fill="none" stroke="#2c3728" stroke-width="4"/>`);
    h.push(`<circle cx="${f(cx + dw / 2 - 24)}" cy="${f((top + ground) / 2)}" r="7" fill="#b39256"/>`);
    lights.push({ x: cx - dw / 2 + 20, y: top - 52, w: dw - 40, h: 16 });
  }
  {
    const x = X0 + step * 2.5 - 90;
    const top = floorTops[0] + 90;
    h.push(`<rect x="${x - 20}" y="${top - 20}" width="220" height="200" fill="${paint}" opacity="0.8"/>`);
    h.push(pane(svg, random, { x, y: top, w: 180, h: 160, glass, sky, curtain, lit: true, lights }));
    for (let bx = x + 16; bx < x + 180; bx += 26) h.push(`<rect x="${bx}" y="${top}" width="4" height="160" fill="${iron}"/>`);
    h.push(`<rect x="${x}" y="${top + 76}" width="180" height="4" fill="${iron}"/>`);
  }
  // A lamp bracket beside the door.
  {
    const lx = X0 + step * 1.5 + 160;
    const ly = floorTops[0] + 40;
    h.push(`<path d="M${lx} ${ly}h40v6h-34v20h-6z" fill="${iron}"/><path d="M${lx + 26} ${ly + 26}h28l-6 46h-16z" fill="${iron}"/><path d="M${lx + 30} ${ly + 30}h20l-5 38h-10z" fill="#efe0b4" opacity="0.7"/>`);
    lights.push({ x: lx + 28, y: ly + 28, w: 24, h: 42 });
  }
  // Jasmine climbing from the left of the door across the first floor.
  h.push(ivy(random, { x: X0 + 70, y: ground - 10, height: 820, spread: 240, leaf: 11, tones: ['#4b5f35', '#5c7140', '#3d5030'], stem: '#4a3c2a', density: 1.3, reach: 1.4 }));
  for (let i = 0; i < 160; i++) h.push(`<circle cx="${f(X0 + 70 + random.range(-200, 220))}" cy="${f(random.range(700, 1400))}" r="${f(random.range(2, 4))}" fill="#f6f1e4" opacity="0.85"/>`);
  svg.add(`<g filter="url(#wobble)">${h.join('')}</g>`);

  // ---- Lane: worn grey stone with the brick-pattern mattonata.
  svg.add(`<rect x="-60" y="${ground}" width="${W + 120}" height="${H - ground + 60}" fill="#77706a"/>`);
  const lane = [];
  for (let y = ground + 6; y < H + 20; y += 22) for (let x = -40 + ((y / 22) % 2) * 26; x < W + 40; x += 52) lane.push(`<rect x="${f(x)}" y="${f(y)}" width="48" height="18" rx="3" fill="${jitter(y > 1530 ? '#8e6650' : '#857d73', random, 0.1)}"/>`);
  lane.push(`<rect x="-60" y="${ground}" width="${W + 120}" height="10" fill="#000" opacity="0.35"/>`);
  svg.add(`<g filter="url(#wobble)">${lane.join('')}</g>`);

  // ---- Light: low late sun into the lane from the right, the lower half in the neighbour's shade.
  svg.add(shadowShape([[-60, 760], [900, 980], [2460, 1120], [2460, H + 60], [-60, H + 60]], { opacity: 0.32, colour: '#2a2c48', blur: 30 }));
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="${H + 120}" fill="${svg.linear([[0, '#2a2016', 0.2], [0.5, '#2a2016', 0], [1, '#ffd391', 0.14]], { x1: 0, y1: 0, x2: 1, y2: 0.2 })}"/>`);
  // Washing line across the lane high up — a single white cloth, nothing more.
  svg.add(`<path d="M520 520Q1220 590 1900 500" stroke="#2c2a26" stroke-width="2.5" fill="none"/><path d="M1300 560h70l-4 84h-62z" fill="#ece5d4" opacity="0.9"/>`);
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="${H + 120}" fill="${svg.radial([[0.55, '#000', 0], [1, '#000', 0.36]], { r: 0.75 })}"/>`);
  const flat = svg.body.join('');
  svg.body = [`<rect width="${W}" height="${H}" fill="${sky}"/>`, `<g filter="url(#brush)">${flat}</g>`, `<rect width="${W}" height="${H}" fill="#7a5a40" opacity="0.07" filter="url(#grain)"/>`];
  return { svg, lights, warm: '#ffc27a' };
}
