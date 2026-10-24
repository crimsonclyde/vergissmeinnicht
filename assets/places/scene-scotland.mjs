/**
 * Scotland — an Edinburgh stone tenement on a sloping street in restrained mist: dark coursed
 * sandstone ashlar, a regular grid of tall sash windows with stone margins, a common stair door with a
 * fanlight, slate roof and dormers, chimney stacks with many cans, black railings, moss in the
 * joints, a hint of hill behind. No castle, no tartan, no flag.
 */
import { Svg, castShadow, f, filters, foliage, jitter, masonry, mix, pane, rng, shade, shadowShape } from './lib.mjs';

export function scene() {
  const W = 2400;
  const H = 1600;
  const random = rng(1767);
  const svg = new Svg(W, H);
  filters(svg, 61);
  const lights = [];

  const mist = '#aeb5b7';
  const sandstone = '#6e6152';
  const slate = '#3d4246';
  const black = '#1a1d1f';
  const glass = '#22282c';

  svg.def(`<filter id="clouds" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">
    <feTurbulence type="fractalNoise" baseFrequency="0.0015 0.004" numOctaves="5" seed="15" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.84  0 0 0 0 0.86  0 0 0 0 0.87  0 0 0 2.2 -0.95"/>
  </filter>`);
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="${H + 120}" fill="${svg.linear([[0, '#7f878d'], [0.5, mist], [1, '#c4c6c0']])}"/>`);
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="900" filter="url(#clouds)" opacity="0.75"/>`);
  // A dark crag far behind, almost lost in the mist.
  svg.add(`<path d="M-60 700C200 520 500 470 760 520C1000 560 1150 430 1400 380C1700 330 2000 470 2460 420V1000H-60Z" fill="${mix('#4f5550', mist, 0.62)}" filter="url(#blur6)"/>`);

  // Neighbouring tenements step down the slope to the right, and up to the left.
  const tenement = (x, w, top, tone, seed) => {
    const r = rng(seed);
    const c = (col) => mix(col, mist, tone);
    const p = [`<rect x="${x}" y="${top}" width="${w}" height="${H}" fill="${c(sandstone)}"/>`];
    p.push(`<path d="M${x - 10} ${top}L${x + 60} ${top - 110}H${x + w - 60}L${x + w + 10} ${top}Z" fill="${c(slate)}"/>`);
    p.push(`<rect x="${x + 80}" y="${top - 200}" width="120" height="120" fill="${c(sandstone)}"/>`);
    for (let row = 0; row < 5; row++) for (let col = 0; col < Math.floor(w / 170); col++) {
      const wx = x + 50 + col * 170;
      const wy = top + 60 + row * 240;
      if (wy > 1300) continue;
      p.push(`<rect x="${wx - 10}" y="${wy - 10}" width="110" height="196" fill="${c(shade(sandstone, 0.12))}"/>`);
      p.push(`<rect x="${wx}" y="${wy}" width="90" height="176" fill="${c(r.chance(0.18) ? '#5e5644' : glass)}"/>`);
      p.push(`<rect x="${wx}" y="${wy + 84}" width="90" height="6" fill="${c('#d9d5cb')}"/>`);
    }
    return `<g filter="url(#wobble)">${p.join('')}</g>`;
  };
  svg.add(tenement(-60, 620, 190, 0.32, 7));
  svg.add(tenement(1860, 620, 330, 0.38, 8));

  // ---- The tenement.
  const X0 = 560;
  const X1 = 1860;
  const FW = X1 - X0;
  const ground = 1440;
  const eaves = 230;
  const h = [];
  // Slate roof with two dormers, a long chimney stack with cans.
  const roofPath = `M${X0 - 20} ${eaves}L${X0 + 80} 70H${X1 - 80}L${X1 + 20} ${eaves}Z`;
  svg.def(`<clipPath id="roof"><path d="${roofPath}"/></clipPath>`);
  h.push(`<path d="${roofPath}" fill="${slate}"/>`);
  const slates = [];
  for (let y = 76; y < eaves; y += 13) for (let x = X0 - 10 + ((y / 13) % 2) * 15; x < X1 + 10; x += 30) slates.push(`<rect x="${f(x)}" y="${y}" width="28" height="12" fill="${jitter(slate, random, 0.14)}"/>`);
  h.push(`<g clip-path="url(#roof)">${slates.join('')}</g>`);
  for (const cx of [X0 + 360, X1 - 360]) {
    h.push(`<path d="M${cx - 90} ${eaves}V120H${cx + 90}V${eaves}Z" fill="${shade(sandstone, -0.05)}"/><path d="M${cx - 100} 128L${cx} 70L${cx + 100} 128" fill="none" stroke="${slate}" stroke-width="16"/>`);
    h.push(pane(svg, random, { x: cx - 56, y: 140, w: 50, h: 84, glass, sky: mist, lit: random.chance(0.5), lights }));
    h.push(pane(svg, random, { x: cx + 6, y: 140, w: 50, h: 84, glass, sky: mist, lit: false, lights }));
  }
  h.push(`<rect x="${X0 + 560}" y="-40" width="200" height="140" fill="${sandstone}"/><rect x="${X0 + 550}" y="-40" width="220" height="18" fill="${shade(sandstone, 0.1)}"/>`);
  for (let k = 0; k < 6; k++) h.push(`<path d="M${X0 + 570 + k * 32} -40l3 -44h18l3 44z" fill="#7d5a45"/>`);
  // Coursed ashlar: dark sandstone blocks, soot-dark at the top, moss in the lowest joints.
  h.push(masonry(svg, random, { x: X0, y: eaves, w: FW, h: ground - eaves, unitW: 130, unitH: 44, mortar: '#4a4239', colours: [sandstone, '#7a6b5a', '#615546', '#837260', '#5a4e41'], spread: 0.07, offset: 0.37, rough: 2 }));
  h.push(`<rect x="${X0}" y="${eaves}" width="${FW}" height="${ground - eaves}" fill="${svg.linear([[0, '#101214', 0.42], [0.35, '#101214', 0.12], [1, '#101214', 0.28]])}" filter="url(#stains)"/>`);
  for (let i = 0; i < 260; i++) h.push(`<ellipse cx="${f(random.range(X0, X1))}" cy="${f(random.range(ground - 260, ground))}" rx="${f(random.range(4, 16))}" ry="${f(random.range(2, 5))}" fill="${jitter('#4f5f37', random, 0.2)}" opacity="0.7"/>`);
  // Cornice under the eaves and band courses.
  h.push(`<rect x="${X0 - 14}" y="${eaves}" width="${FW + 28}" height="30" fill="${shade(sandstone, 0.08)}"/>`);
  h.push(castShadow(svg, { x: X0, y: eaves + 30, w: FW, h: 46, opacity: 0.4 }));
  const floors = [1130, 880, 650, 430];
  for (const top of floors) h.push(`<rect x="${X0}" y="${top - 16}" width="${FW}" height="14" fill="${shade(sandstone, 0.1)}"/>` + castShadow(svg, { x: X0, y: top - 2, w: FW, h: 18, opacity: 0.3 }));

  // Sash windows in a strict grid, with smooth stone margins and a projecting sill.
  const curtain = '#ddd8cc';
  const cols = 5;
  const step = FW / cols;
  const sash = (cx, top, height) => {
    const w = 110;
    const x = cx - w / 2;
    const out = [];
    out.push(`<rect x="${f(x - 22)}" y="${f(top - 22)}" width="${w + 44}" height="${height + 40}" fill="${shade(sandstone, 0.14)}"/>`);
    out.push(`<rect x="${f(x)}" y="${f(top)}" width="${w}" height="${height}" fill="#e7e2d6"/>`);
    const ph = (height - 22) / 2;
    const lit = random.chance(0.3);
    for (const row of [0, 1]) out.push(pane(svg, random, { x: x + 7, y: top + 7 + row * (ph + 8), w: w - 14, h: ph, glass, sky: mist, curtain, lit, lights }));
    out.push(`<rect x="${f(x)}" y="${f(top)}" width="${w}" height="9" fill="#000" opacity="0.3"/><rect x="${f(x)}" y="${f(top)}" width="7" height="${height}" fill="#000" opacity="0.2"/>`);
    out.push(`<rect x="${f(x - 28)}" y="${f(top + height + 16)}" width="${w + 56}" height="14" fill="${shade(sandstone, 0.18)}"/>`);
    out.push(castShadow(svg, { x: x - 28, y: top + height + 30, w: w + 56, h: 26, opacity: 0.38 }));
    return out.join('');
  };
  for (let fl = 0; fl < 4; fl++) {
    const top = floors[fl] - 200 + (fl === 3 ? 0 : 0);
    const height = [0, 190, 180, 170][fl] || 175;
    if (fl === 0) continue;
    for (let c = 0; c < cols; c++) h.push(sash(X0 + step * (c + 0.5), floors[fl] + 26, height));
  }
  for (let c = 0; c < cols; c++) h.push(sash(X0 + step * (c + 0.5), eaves + 70, 140));
  // Ground floor: the common stair door (left), a shop front with a dark painted fascia (right).
  {
    const cx = X0 + step * 0.5 + 40;
    const dw = 140;
    const top = floors[0] + 40;
    h.push(`<rect x="${f(cx - dw / 2 - 30)}" y="${f(top - 30)}" width="${dw + 60}" height="${f(ground - top + 30)}" fill="${shade(sandstone, 0.12)}"/>`);
    h.push(`<rect x="${f(cx - dw / 2)}" y="${f(top + 70)}" width="${dw}" height="${f(ground - top - 70)}" fill="#24312f"/>`);
    h.push(pane(svg, random, { x: cx - dw / 2 + 8, y: top + 6, w: dw - 16, h: 56, glass, sky: mist, lit: true, lights }));
    for (const row of [0, 1]) h.push(`<rect x="${f(cx - dw / 2 + 16)}" y="${f(top + 90 + row * 100)}" width="${dw - 32}" height="80" fill="none" stroke="#141c1b" stroke-width="4"/>`);
    h.push(`<circle cx="${f(cx + 40)}" cy="${f(top + 200)}" r="6" fill="#a68a4f"/>`);
  }
  {
    const x = X0 + step * 1.5;
    const w = FW - step * 1.5 - 60;
    const top = floors[0] + 10;
    h.push(`<rect x="${f(x)}" y="${f(top)}" width="${f(w)}" height="70" fill="#1f2a30"/>`);
    h.push(`<rect x="${f(x)}" y="${f(top + 70)}" width="${f(w)}" height="${f(ground - top - 70)}" fill="#24323a"/>`);
    for (let i = 0; i < 4; i++) h.push(pane(svg, random, { x: x + 20 + i * ((w - 40) / 4), y: top + 90, w: (w - 40) / 4 - 16, h: 200, glass, sky: mist, lit: i !== 3, lights }));
    h.push(`<rect x="${f(x)}" y="${f(ground - 70)}" width="${f(w)}" height="70" fill="#1e2a30"/>`);
  }
  // Railings by the stair door.
  for (let x = X0 + 10; x < X0 + step * 1.4; x += 16) h.push(`<path d="M${x} ${ground}v-110m-4 0l4 -12l4 12" stroke="${black}" stroke-width="3.5" fill="${black}"/>`);
  h.push(`<rect x="${X0}" y="${ground - 110}" width="${f(step * 1.4)}" height="5" fill="${black}"/>`);
  svg.add(`<g filter="url(#wobble)">${h.join('')}</g>`);

  // ---- Street: setts, wet; the kerb.
  svg.add(`<rect x="-60" y="${ground}" width="${W + 120}" height="${H - ground + 60}" fill="#4d4f4f"/>`);
  const setts = [];
  for (let y = ground + 50; y < H + 20; y += 24) for (let x = -40 + ((y / 24) % 2) * 22; x < W + 40; x += 44) setts.push(`<rect x="${f(x)}" y="${f(y)}" width="40" height="20" rx="4" fill="${jitter('#5c5f60', random, 0.12)}"/>`);
  setts.push(`<rect x="-60" y="${ground}" width="${W + 120}" height="46" fill="#77786f"/>`);
  for (const [x, a] of [[X0 + step * 2.5, 0.16], [X0 + 200, 0.12]]) setts.push(`<rect x="${f(x - 140)}" y="${ground + 50}" width="280" height="${H}" fill="#e4d7ad" opacity="${a}" filter="url(#blur14)"/>`);
  svg.add(`<g filter="url(#wobble)">${setts.join('')}</g>`);
  // A rowan's branches in the near left corner, its berries muted.
  {
    const t = [`<path d="M-60 120C120 160 260 230 380 340" stroke="#2c2a27" stroke-width="16" fill="none" stroke-linecap="round"/>`];
    t.push(foliage(random, { cx: 120, cy: 210, rx: 360, ry: 190, tones: ['#4b5739', '#3f4a31', '#56603f'], leaf: 22, count: 480, lit: '#a8ad86' }));
    for (let i = 0; i < 40; i++) t.push(`<circle cx="${f(random.range(40, 360))}" cy="${f(random.range(220, 360))}" r="${f(random.range(5, 8))}" fill="#8e3e2f"/>`);
    svg.add(`<g filter="url(#blur6)" opacity="0.94">${t.join('')}</g>`);
  }
  // ---- Mist: a low bank in the street, a veil over the distance.
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="${H + 120}" fill="${svg.linear([[0, mist, 0.08], [0.55, mist, 0.16], [0.85, mist, 0.4], [1, mist, 0.2]])}"/>`);
  svg.add(shadowShape([[-60, 1150], [2460, 1000], [2460, H + 60], [-60, H + 60]], { opacity: 0.16, colour: '#1c2433', blur: 30 }));
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="${H + 120}" fill="${svg.radial([[0.5, '#000', 0], [1, '#000', 0.42]], { r: 0.75 })}"/>`);
  const flat = svg.body.join('');
  svg.body = [`<rect width="${W}" height="${H}" fill="${mist}"/>`, `<g filter="url(#brush)">${flat}</g>`, `<rect width="${W}" height="${H}" fill="#55606a" opacity="0.07" filter="url(#grain)"/>`];
  return { svg, lights, warm: '#ffd08c' };
}
