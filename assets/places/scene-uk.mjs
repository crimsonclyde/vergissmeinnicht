/**
 * United Kingdom — a Victorian London terrace house in fog: dark London stock brick, a white stucco
 * ground floor, a two-storey canted bay, sash windows, a portico with columns, a black door with a
 * fanlight, black area railings and steps, a parapet with chimney stacks, a plane tree's branches.
 * Subdued, grey and quiet. No landmark, no flag.
 */
import { Svg, castShadow, f, filters, foliage, jitter, masonry, mix, pane, rng, shade, shadowShape } from './lib.mjs';

export function scene() {
  const W = 2400;
  const H = 1600;
  const random = rng(1837);
  const svg = new Svg(W, H);
  filters(svg, 53);
  const lights = [];

  const fog = '#b7b8b6';
  const brick = '#6a5a49';
  const stucco = '#dcd6c9';
  const black = '#1d1f22';
  const glass = '#25292e';
  const burgundy = '#5d2733';

  svg.def(`<filter id="clouds" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">
    <feTurbulence type="fractalNoise" baseFrequency="0.0018 0.004" numOctaves="5" seed="5" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.86  0 0 0 0 0.86  0 0 0 0 0.85  0 0 0 2 -0.9"/>
  </filter>`);
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="${H + 120}" fill="${svg.linear([[0, '#8d9196'], [0.55, fog], [1, '#c9c5bb']])}"/>`);
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="900" filter="url(#clouds)" opacity="0.7"/>`);

  // The terrace continues on both sides, fading into the fog.
  const terrace = (x0, dir, seed) => {
    const r = rng(seed);
    const p = [];
    for (let i = 0; i < 3; i++) {
      const x = dir > 0 ? x0 + i * 620 : x0 - (i + 1) * 620;
      const fade = 0.3 + i * 0.22;
      const c = (col) => mix(col, fog, fade);
      p.push(`<rect x="${x}" y="230" width="620" height="${H}" fill="${c(brick)}"/>`);
      p.push(`<rect x="${x}" y="1120" width="620" height="${H}" fill="${c(stucco)}"/>`);
      p.push(`<rect x="${x - 6}" y="200" width="632" height="40" fill="${c(stucco)}"/>`);
      for (const cx of [x + 120, x + 480]) p.push(`<rect x="${cx}" y="110" width="80" height="100" fill="${c('#5a4b3e')}"/>`);
      for (let row = 0; row < 3; row++) for (const wx of [x + 90, x + 260, x + 430]) {
        const wy = 300 + row * 270;
        p.push(`<rect x="${wx}" y="${wy}" width="100" height="${row === 0 ? 210 : 190}" fill="${c('#e6e1d6')}"/>`);
        p.push(`<rect x="${wx + 7}" y="${wy + 7}" width="86" height="${row === 0 ? 196 : 176}" fill="${c(r.chance(0.2) ? '#6e5f45' : '#2e3338')}"/>`);
        p.push(`<rect x="${wx}" y="${wy + (row === 0 ? 100 : 90)}" width="100" height="6" fill="${c('#e6e1d6')}"/>`);
      }
      p.push(`<rect x="${x}" y="1360" width="620" height="8" fill="${c(black)}"/>`);
      for (let bx = x; bx < x + 620; bx += 16) p.push(`<rect x="${bx}" y="1290" width="3" height="80" fill="${c(black)}"/>`);
    }
    return `<g filter="url(#wobble)">${p.join('')}</g>`;
  };
  svg.add(terrace(1880, 1, 2));
  svg.add(terrace(520, -1, 3));

  // ---- The house.
  const X0 = 520;
  const X1 = 1880;
  const FW = X1 - X0;
  const ground = 1400;
  const stuccoTop = 1060;
  const parapet = 210;
  const h = [];
  // Chimney stacks with pots.
  for (const cx of [X0 + 80, X1 - 260]) {
    h.push(`<rect x="${cx}" y="40" width="180" height="180" fill="${brick}"/><rect x="${cx - 10}" y="40" width="200" height="22" fill="${stucco}"/>`);
    for (let k = 0; k < 4; k++) h.push(`<path d="M${cx + 14 + k * 42} 40l4 -60h22l4 60z" fill="#8a5a42"/>`);
  }
  // Brick wall in London stock, with soot.
  h.push(masonry(svg, random, { x: X0, y: parapet, w: FW, h: stuccoTop - parapet, unitW: 46, unitH: 15, mortar: '#8c8578', colours: [brick, '#5d4f40', '#7b6852', '#4f453a', '#816c4d'], spread: 0.12 }));
  h.push(`<rect x="${X0}" y="${parapet}" width="${FW}" height="${stuccoTop - parapet}" fill="${svg.linear([[0, '#141414', 0.35], [0.5, '#141414', 0.12], [1, '#141414', 0.3]])}" filter="url(#stains)"/>`);
  // Parapet with a stucco cornice.
  h.push(`<rect x="${X0 - 20}" y="${parapet - 30}" width="${FW + 40}" height="44" fill="${stucco}"/>`);
  for (let x = X0; x < X1; x += 40) h.push(`<rect x="${x}" y="${parapet + 14}" width="18" height="16" fill="${shade(stucco, -0.06)}"/>`);
  h.push(castShadow(svg, { x: X0, y: parapet + 30, w: FW, h: 50, opacity: 0.4 }));
  // Stucco ground floor with channelled joints.
  h.push(`<rect x="${X0}" y="${stuccoTop}" width="${FW}" height="${ground - stuccoTop}" fill="${svg.linear([[0, shade(stucco, 0.04)], [1, shade(stucco, -0.14)]])}" filter="url(#stains)"/>`);
  for (let y = stuccoTop + 36; y < ground; y += 36) h.push(`<rect x="${X0}" y="${y}" width="${FW}" height="3" fill="${shade(stucco, -0.25)}"/>`);
  h.push(`<rect x="${X0 - 10}" y="${stuccoTop - 20}" width="${FW + 20}" height="24" fill="${shade(stucco, 0.06)}"/>`);
  h.push(castShadow(svg, { x: X0, y: stuccoTop + 4, w: FW, h: 30, opacity: 0.3 }));

  const curtain = '#e3dccd';
  const sash = (x, y, w, height, lit) => {
    const out = [];
    out.push(`<rect x="${f(x - 10)}" y="${f(y - 10)}" width="${f(w + 20)}" height="${f(height + 20)}" fill="${shade(stucco, 0.08)}"/>`);
    out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(height)}" fill="#f0ebe0"/>`);
    // Upper and lower sash, two-over-two.
    const ph = (height - 24) / 2;
    for (const row of [0, 1]) for (const col of [0, 1]) out.push(pane(svg, random, { x: x + 8 + col * ((w - 16) / 2 + 2), y: y + 8 + row * (ph + 8), w: (w - 16) / 2 - 2, h: ph, glass, sky: fog, curtain, lit, lights }));
    out.push(`<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="8" fill="#000" opacity="0.25"/>`);
    out.push(`<rect x="${f(x - 16)}" y="${f(y + height + 10)}" width="${f(w + 32)}" height="12" fill="${shade(stucco, 0.1)}"/>`);
    out.push(castShadow(svg, { x: x - 16, y: y + height + 22, w: w + 32, h: 22, opacity: 0.35 }));
    // Gauged brick flat arch above.
    out.push(`<rect x="${f(x - 10)}" y="${f(y - 34)}" width="${f(w + 20)}" height="24" fill="#7d5f45"/>`);
    for (let k = x - 6; k < x + w + 8; k += 10) out.push(`<rect x="${f(k)}" y="${f(y - 34)}" width="1.5" height="24" fill="#4b3a2c"/>`);
    return out.join('');
  };
  // A two-storey canted bay on the left: three faces with light falling differently on each.
  {
    const bx = X0 + 110;
    const bw = 480;
    const top = 640;
    const faces = [
      { x: bx, w: 110, tone: -0.12 },
      { x: bx + 110, w: 260, tone: 0.04 },
      { x: bx + 370, w: 110, tone: -0.22 },
    ];
    for (const face of faces) {
      h.push(`<rect x="${face.x}" y="${top}" width="${face.w}" height="${ground - top}" fill="${shade(stucco, face.tone)}"/>`);
      h.push(sash(face.x + 18, top + 60, face.w - 36, 240, random.chance(0.4)));
      h.push(sash(face.x + 18, stuccoTop + 50, face.w - 36, 210, random.chance(0.5)));
    }
    h.push(`<rect x="${bx - 16}" y="${top - 30}" width="${bw + 32}" height="34" fill="${shade(stucco, 0.08)}"/>`);
    h.push(`<rect x="${bx - 10}" y="${top - 46}" width="${bw + 20}" height="18" fill="${black}"/>`);
    for (let x = bx; x < bx + bw; x += 18) h.push(`<rect x="${x}" y="${top - 90}" width="3" height="46" fill="${black}"/>`);
    h.push(`<rect x="${bx - 10}" y="${top - 92}" width="${bw + 20}" height="5" fill="${black}"/>`);
    h.push(`<rect x="${bx + 480}" y="${top}" width="24" height="${ground - top}" fill="#000" opacity="0.18" filter="url(#blur6)"/>`);
  }
  // Upper floors: tall sashes on the first floor (with a balconette), shorter above.
  const cols = [X0 + 760, X0 + 1060];
  for (const cx of cols) {
    h.push(sash(cx, 330, 170, 260, random.chance(0.35)));
    h.push(sash(cx, 700, 170, 300, random.chance(0.35)));
    h.push(`<rect x="${cx - 20}" y="${1004}" width="210" height="6" fill="${black}"/>`);
    for (let x = cx - 16; x < cx + 190; x += 14) h.push(`<path d="M${x} 1004v-56" stroke="${black}" stroke-width="3"/>`);
    h.push(`<rect x="${cx - 20}" y="946" width="210" height="5" fill="${black}"/>`);
  }
  h.push(sash(X0 + 220, 330, 170, 220, random.chance(0.35)));
  // Portico: two columns, an entablature, a black door with fanlight and a brass knocker.
  {
    const cx = X0 + 1000;
    const pw = 360;
    const top = stuccoTop + 10;
    h.push(`<rect x="${f(cx - pw / 2)}" y="${f(top - 40)}" width="${pw}" height="50" fill="${shade(stucco, 0.1)}"/>`);
    h.push(castShadow(svg, { x: cx - pw / 2, y: top + 10, w: pw, h: 40, opacity: 0.45 }));
    for (const dx of [-pw / 2 + 14, pw / 2 - 54]) {
      h.push(`<rect x="${f(cx + dx)}" y="${f(top + 10)}" width="40" height="${f(ground - top - 10)}" fill="${svg.linear([[0, shade(stucco, -0.15)], [0.4, shade(stucco, 0.08)], [1, shade(stucco, -0.25)]], { x1: 0, y1: 0, x2: 1, y2: 0 })}"/>`);
      h.push(`<rect x="${f(cx + dx - 6)}" y="${f(top + 10)}" width="52" height="16" fill="${shade(stucco, 0.05)}"/>`);
    }
    const dw = 150;
    h.push(`<rect x="${f(cx - dw / 2 - 20)}" y="${f(top + 20)}" width="${dw + 40}" height="${f(ground - top - 20)}" fill="#2b2b2c"/>`);
    h.push(`<path d="M${f(cx - dw / 2)} ${f(top + 100)}A${dw / 2} ${dw / 2} 0 0 1 ${f(cx + dw / 2)} ${f(top + 100)}Z" fill="${glass}"/>`);
    for (let a = 0; a < 7; a++) {
      const ang = Math.PI + (a / 6) * Math.PI;
      h.push(`<path d="M${f(cx)} ${f(top + 100)}L${f(cx + Math.cos(ang) * dw / 2)} ${f(top + 100 + Math.sin(ang) * dw / 2)}" stroke="#d9d2c2" stroke-width="2.5"/>`);
    }
    lights.push({ x: cx - dw / 2 + 10, y: top + 40, w: dw - 20, h: 58 });
    h.push(`<rect x="${f(cx - dw / 2)}" y="${f(top + 104)}" width="${dw}" height="${f(ground - top - 104)}" fill="${burgundy === '' ? black : '#17191c'}"/>`);
    for (const row of [0, 1]) for (const col of [0, 1]) h.push(`<rect x="${f(cx - dw / 2 + 14 + col * 68)}" y="${f(top + 120 + row * 100)}" width="54" height="84" fill="none" stroke="#0b0c0d" stroke-width="4"/>`);
    h.push(`<circle cx="${f(cx)}" cy="${f(top + 190)}" r="9" fill="none" stroke="#b39152" stroke-width="4"/>`);
    h.push(`<text x="${f(cx)}" y="${f(top + 74)}" font-family="Georgia, serif" font-size="22" fill="#e8e2d2" text-anchor="middle" opacity="0.8">14</text>`);
  }
  // Basement area railings and steps.
  h.push(`<rect x="${X0}" y="${ground - 10}" width="${FW}" height="12" fill="${black}"/>`);
  for (let x = X0 + 4; x < X1; x += 18) h.push(`<path d="M${x} ${ground - 10}v-120m-4 0l4 -14l4 14" stroke="${black}" stroke-width="3.5" fill="${black}"/>`);
  h.push(`<rect x="${X0}" y="${ground - 120}" width="${FW}" height="5" fill="${black}"/>`);
  // A plane tree's branches from the right edge (the trunk is out of frame).
  svg.add(`<g filter="url(#wobble)">${h.join('')}</g>`);
  {
    const t = [];
    t.push(`<path d="M2460 260C2200 300 2050 260 1880 330C1760 380 1680 360 1600 420" stroke="#3a3530" stroke-width="22" fill="none" stroke-linecap="round"/>`);
    t.push(`<path d="M2050 290C2000 200 1950 160 1860 140" stroke="#3a3530" stroke-width="12" fill="none" stroke-linecap="round"/>`);
    t.push(foliage(random, { cx: 2050, cy: 280, rx: 520, ry: 220, tones: ['#56603f', '#4a5537', '#636c47'], leaf: 34, count: 520, lit: '#b9b78a', litSide: 1 }));
    svg.add(`<g filter="url(#blur6)" opacity="0.92">${t.join('')}</g>`);
  }
  // ---- Pavement: York stone slabs, a granite kerb and wet reflections.
  svg.add(`<rect x="-60" y="${ground}" width="${W + 120}" height="${H - ground + 60}" fill="#76726c"/>`);
  const pave = [];
  for (let x = -40; x < W + 40; x += 150) pave.push(`<rect x="${x + 2}" y="${ground + 4}" width="146" height="${f(random.range(80, 110))}" fill="${jitter('#8b8780', random, 0.06)}"/>`);
  pave.push(`<rect x="-60" y="${ground + 120}" width="${W + 120}" height="24" fill="#5d5a55"/>`);
  pave.push(`<rect x="-60" y="${ground + 144}" width="${W + 120}" height="${H}" fill="#3c3d3f"/>`);
  for (const l of [[1000, 0.18], [700, 0.1]]) pave.push(`<rect x="${l[0] - 80}" y="${ground + 150}" width="160" height="${H}" fill="#c9c1a8" opacity="${l[1]}" filter="url(#blur14)"/>`);
  svg.add(`<g filter="url(#wobble)">${pave.join('')}</g>`);
  // A street lamp at the left edge of the house.
  {
    const lx = 300;
    const lamp = [];
    lamp.push(`<rect x="${lx - 10}" y="${ground - 640}" width="20" height="${640 + 120}" fill="${black}"/>`);
    lamp.push(`<path d="M${lx - 44} ${ground - 640}h88l-16 -96h-56z" fill="${black}"/><path d="M${lx - 34} ${ground - 646}h68l-12 -82h-44z" fill="#ece3c4" opacity="0.6"/><path d="M${lx - 50} ${ground - 734}h100l-50 -36z" fill="${black}"/>`);
    svg.add(`<g filter="url(#wobble)">${lamp.join('')}</g>`);
    lights.push({ x: lx - 32, y: ground - 726, w: 64, h: 78 });
  }
  // ---- Fog: thicker in the distance and near the ground, a little over everything.
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="${H + 120}" fill="${svg.linear([[0, fog, 0.0], [0.6, fog, 0.18], [0.9, fog, 0.32], [1, fog, 0.12]])}"/>`);
  svg.add(shadowShape([[-60, 1180], [2460, 940], [2460, H + 60], [-60, H + 60]], { opacity: 0.18, colour: '#1e2638', blur: 30 }));
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="${H + 120}" fill="${svg.radial([[0.5, '#000', 0], [1, '#000', 0.4]], { r: 0.75 })}"/>`);
  const flat = svg.body.join('');
  svg.body = [`<rect width="${W}" height="${H}" fill="${fog}"/>`, `<g filter="url(#brush)">${flat}</g>`, `<rect width="${W}" height="${H}" fill="#5a5e66" opacity="0.07" filter="url(#grain)"/>`];
  return { svg, lights, warm: '#ffcf86' };
}
