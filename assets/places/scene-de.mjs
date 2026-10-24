/**
 * Germany — a Berlin/Leipzig Altbau (Gründerzeit apartment house): aged ochre-cream plaster, a
 * rusticated brick-red ground floor, tall double casements with transoms, stucco pediments on the
 * Beletage, a wrought-iron balcony, a heavy cornice, a slate mansard with dormers, ivy, Berlin paving
 * and an old gas lamp. Neighbours fade into the haze. No landmark, no flag.
 */
import { Svg, castShadow, f, filters, foliage, ivy, jitter, masonry, mix, pane, rng, shade, shadowShape } from './lib.mjs';

export function scene() {
  const W = 2400;
  const H = 1600;
  const random = rng(4711);
  const svg = new Svg(W, H);
  filters(svg, 31);
  const lights = [];

  const sky = '#c9c3b6';
  const plaster = '#cdbb98';
  const plasterDark = '#a8936e';
  const brick = '#8a4b3b';
  const charcoal = '#2c2a28';
  const gold = '#b08d4f';
  const glass = '#2b3036';

  // ---- Sky: an overcast afternoon, warmer at the horizon.
  svg.def(`<filter id="clouds" x="0" y="0" width="100%" height="100%" filterUnits="userSpaceOnUse">
    <feTurbulence type="fractalNoise" baseFrequency="0.0016 0.006" numOctaves="5" seed="9" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.95  0 0 0 0 0.91  0 0 0 0 0.84  0 0 0 2.4 -1.05"/>
  </filter>`);
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="${H + 120}" fill="${svg.linear([[0, '#8e939a'], [0.45, sky], [1, '#e3cfa8']])}"/>`);
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="700" filter="url(#clouds)" opacity="0.8"/>`);
  svg.add(`<g filter="url(#blur60)" opacity="0.55"><ellipse cx="300" cy="320" rx="700" ry="160" fill="#f3dcae"/></g>`);

  // ---- Neighbours (left: grey-green plaster; right: older brick), hazed.
  const haze = (c, t = 0.35) => mix(c, sky, t);
  const neighbour = (x, w, top, wall, windowRows, seed, roof) => {
    const r = rng(seed);
    const parts = [`<rect x="${x}" y="${top}" width="${w}" height="${H - top}" fill="${haze(wall)}"/>`];
    parts.push(`<rect x="${x}" y="${top - 26}" width="${w}" height="30" fill="${haze(shade(wall, -0.2))}"/>`);
    if (roof) parts.push(`<path d="M${x - 10} ${top - 26}L${x + 40} ${top - 120}H${x + w - 40}L${x + w + 10} ${top - 26}Z" fill="${haze('#4a4d52', 0.45)}"/>`);
    const cols = Math.floor(w / 190);
    for (let row = 0; row < windowRows; row++) {
      for (let c = 0; c < cols; c++) {
        const wx = x + 50 + c * ((w - 100) / cols) + 20;
        const wy = top + 60 + row * 225;
        if (wy > 1250) continue;
        parts.push(`<rect x="${f(wx)}" y="${f(wy)}" width="96" height="160" fill="${haze(shade(wall, 0.12))}"/>`);
        parts.push(`<rect x="${f(wx + 8)}" y="${f(wy + 8)}" width="80" height="144" fill="${haze(r.chance(0.2) ? '#5b5446' : '#3a3d40', 0.3)}"/>`);
        parts.push(`<rect x="${f(wx + 46)}" y="${f(wy + 8)}" width="4" height="144" fill="${haze(shade(wall, 0.1))}"/>`);
        parts.push(`<rect x="${f(wx - 6)}" y="${f(wy + 160)}" width="108" height="10" fill="${haze(shade(wall, 0.25))}"/>`);
      }
    }
    return `<g filter="url(#wobble)">${parts.join('')}</g>`;
  };
  svg.add(neighbour(-40, 640, 300, '#8f9a8c', 6, 12, true));
  svg.add(neighbour(1820, 640, 250, '#9a5a48', 6, 13, false));
  // Shadow where the neighbours meet the main façade.
  svg.add(`<rect x="540" y="0" width="40" height="${H}" fill="#000" opacity="0.18" filter="url(#blur14)"/>`);
  svg.add(`<rect x="1820" y="0" width="30" height="${H}" fill="#000" opacity="0.22" filter="url(#blur14)"/>`);

  // ---- Main house.
  const X0 = 580;
  const X1 = 1820;
  const FW = X1 - X0;
  const ground = 1450;
  const floors = [1160, 905, 665, 440, 220]; // tops of: ground floor, 1st (Beletage), 2nd, 3rd, 4th
  const cornice = 190;
  const house = [];

  // Mansard roof with slates and dormers.
  const roofPath = `M${X0 - 30} ${cornice}L${X0 + 70} 40H${X1 - 70}L${X1 + 30} ${cornice}Z`;
  svg.def(`<clipPath id="roof"><path d="${roofPath}"/></clipPath>`);
  house.push(`<path d="${roofPath}" fill="#3a3c40"/>`);
  const slates = [];
  for (let y = 46; y < cornice; y += 14) for (let x = X0 - 30; x < X1 + 30; x += 26) slates.push(`<rect x="${f(x + ((y / 14) % 2) * 13)}" y="${y}" width="24" height="12" rx="2" fill="${jitter('#45474c', random, 0.12)}"/>`);
  house.push(`<g clip-path="url(#roof)">${slates.join('')}</g>`);
  for (const dx of [0.2, 0.5, 0.8]) {
    const cx = X0 + FW * dx;
    house.push(`<path d="M${f(cx - 70)} 175V95L${f(cx)} 52L${f(cx + 70)} 95V175Z" fill="${shade(plaster, -0.08)}"/>`);
    house.push(`<path d="M${f(cx - 80)} 98L${f(cx)} 46L${f(cx + 80)} 98" fill="none" stroke="#2f3135" stroke-width="10"/>`);
    house.push(pane(svg, random, { x: cx - 42, y: 98, w: 38, h: 70, glass, sky, lit: random.chance(0.4), lights }));
    house.push(pane(svg, random, { x: cx + 4, y: 98, w: 38, h: 70, glass, sky, lit: false, lights }));
  }
  // Chimneys.
  for (const cx of [X0 + 140, X1 - 220]) {
    house.push(`<rect x="${cx}" y="-10" width="70" height="70" fill="${brick}"/><rect x="${cx - 8}" y="-10" width="86" height="14" fill="${shade(brick, -0.25)}"/>`);
  }

  // Plaster wall of the upper floors, weathered.
  house.push(`<rect x="${X0}" y="${cornice}" width="${FW}" height="${floors[0] - cornice}" fill="${svg.linear([[0, shade(plaster, 0.05)], [0.7, plaster], [1, plasterDark]], { x1: 0, y1: 0, x2: 0.3, y2: 1 })}" filter="url(#stains)"/>`);
  // Fine horizontal rustication lines on the Beletage.
  for (let y = floors[1] + 20; y < floors[0]; y += 28) house.push(`<rect x="${X0}" y="${y}" width="${FW}" height="2" fill="${plasterDark}" opacity="0.55"/>`);
  // Corner pilasters (quoins).
  for (const qx of [X0, X1 - 46]) for (let y = cornice + 10; y < floors[0]; y += 46) house.push(`<rect x="${qx + (((y / 46) | 0) % 2 === 0 ? 0 : 6)}" y="${y}" width="40" height="40" fill="${jitter(shade(plaster, 0.08), random, 0.04)}"/>`);

  // Heavy cornice with brackets.
  house.push(`<rect x="${X0 - 30}" y="${cornice - 6}" width="${FW + 60}" height="34" fill="${shade(plaster, 0.1)}"/>`);
  house.push(`<rect x="${X0 - 20}" y="${cornice + 28}" width="${FW + 40}" height="12" fill="${plasterDark}"/>`);
  for (let x = X0; x < X1; x += 52) house.push(`<rect x="${x}" y="${cornice + 40}" width="22" height="26" fill="${shade(plaster, 0.06)}"/><rect x="${x}" y="${cornice + 62}" width="22" height="4" fill="${plasterDark}"/>`);
  house.push(castShadow(svg, { x: X0, y: cornice + 66, w: FW, h: 60, opacity: 0.32 }));

  // String courses between floors.
  for (const top of floors.slice(0, 4)) {
    house.push(`<rect x="${X0 - 8}" y="${top - 18}" width="${FW + 16}" height="18" fill="${shade(plaster, 0.12)}"/>`);
    house.push(castShadow(svg, { x: X0, y: top, w: FW, h: 26, opacity: 0.25 }));
  }

  // Windows: five axes, tall double casements with transom.
  const axes = 5;
  const step = FW / axes;
  const curtain = '#e9dfcd';
  const windowAt = (cx, top, height, floor) => {
    const w = 118;
    const x = cx - w / 2;
    const out = [];
    // Surround.
    out.push(`<rect x="${f(x - 16)}" y="${f(top - 14)}" width="${f(w + 32)}" height="${f(height + 30)}" fill="${shade(plaster, 0.14)}"/>`);
    out.push(`<rect x="${f(x - 6)}" y="${f(top - 4)}" width="${f(w + 12)}" height="${f(height + 10)}" fill="${shade(plaster, -0.12)}"/>`);
    // Recess shadow and frame.
    out.push(`<rect x="${f(x)}" y="${f(top)}" width="${w}" height="${height}" fill="#ddd5c4"/>`);
    const fx = x + 7;
    const fw = w - 14;
    const transom = height * 0.26;
    const lit = random.chance(floor >= 3 ? 0.35 : 0.22);
    out.push(pane(svg, random, { x: fx, y: top + 7, w: fw, h: transom - 10, glass, sky, lit, lights }));
    const half = (fw - 6) / 2;
    for (const side of [0, 1]) {
      const px = fx + side * (half + 6);
      out.push(pane(svg, random, { x: px, y: top + transom + 2, w: half, h: (height - transom - 14) * 0.55, glass, sky, curtain, lit, lights }));
      out.push(pane(svg, random, { x: px, y: top + transom + 6 + (height - transom - 14) * 0.55, w: half, h: (height - transom - 14) * 0.45 - 4, glass, sky, lit, lights }));
    }
    // Inner shadow on the left/top of the recess.
    out.push(`<rect x="${f(x)}" y="${f(top)}" width="${w}" height="10" fill="#000" opacity="0.28"/><rect x="${f(x)}" y="${f(top)}" width="8" height="${height}" fill="#000" opacity="0.18"/>`);
    // Sill.
    out.push(`<rect x="${f(x - 22)}" y="${f(top + height + 12)}" width="${f(w + 44)}" height="14" fill="${shade(plaster, 0.18)}"/>`);
    out.push(castShadow(svg, { x: x - 22, y: top + height + 26, w: w + 44, h: 24, opacity: 0.3 }));
    // Pediment: triangular on the Beletage, segmental on the 2nd floor, a keystone above.
    if (floor === 1) {
      out.push(`<path d="M${f(x - 30)} ${f(top - 16)}L${f(cx)} ${f(top - 74)}L${f(x + w + 30)} ${f(top - 16)}Z" fill="${shade(plaster, 0.16)}"/>`);
      out.push(`<path d="M${f(x - 14)} ${f(top - 22)}L${f(cx)} ${f(top - 62)}L${f(x + w + 14)} ${f(top - 22)}Z" fill="${shade(plaster, -0.04)}"/>`);
      out.push(castShadow(svg, { x: x - 30, y: top - 16, w: w + 60, h: 14, opacity: 0.35 }));
    } else if (floor === 2) {
      out.push(`<path d="M${f(x - 26)} ${f(top - 16)}Q${f(cx)} ${f(top - 64)} ${f(x + w + 26)} ${f(top - 16)}Z" fill="${shade(plaster, 0.16)}"/>`);
      out.push(castShadow(svg, { x: x - 26, y: top - 16, w: w + 52, h: 12, opacity: 0.32 }));
    } else {
      out.push(`<path d="M${f(cx - 16)} ${f(top - 18)}H${f(cx + 16)}L${f(cx + 11)} ${f(top + 14)}H${f(cx - 11)}Z" fill="${shade(plaster, 0.2)}"/>`);
    }
    return out.join('');
  };
  const heights = { 1: 205, 2: 190, 3: 175, 4: 160 };
  for (let floor = 1; floor <= 4; floor++) {
    const top = floors[floor] + (floor === 1 ? 50 : 40);
    for (let a = 0; a < axes; a++) house.push(windowAt(X0 + step * (a + 0.5), top, heights[floor], floor));
  }

  // Balcony on the 2nd floor, middle axis: stone slab on brackets and a wrought-iron railing.
  {
    const cx = X0 + step * 2.5;
    const by = floors[2] + 40 + heights[2] + 10;
    const bw = 300;
    house.push(`<rect x="${f(cx - bw / 2)}" y="${f(by)}" width="${bw}" height="18" fill="${shade(plaster, 0.18)}"/>`);
    for (const dx of [-110, 0, 110]) house.push(`<path d="M${f(cx + dx - 14)} ${f(by + 18)}h28l-6 40h-16z" fill="${shade(plaster, 0.05)}"/>`);
    house.push(castShadow(svg, { x: cx - bw / 2, y: by + 18, w: bw, h: 50, opacity: 0.35 }));
    const rail = [];
    const rh = 82;
    rail.push(`<rect x="${f(cx - bw / 2)}" y="${f(by - rh)}" width="${bw}" height="5" fill="${charcoal}"/>`);
    rail.push(`<rect x="${f(cx - bw / 2)}" y="${f(by - 14)}" width="${bw}" height="4" fill="${charcoal}"/>`);
    for (let x = cx - bw / 2 + 8; x < cx + bw / 2; x += 14) rail.push(`<rect x="${f(x)}" y="${f(by - rh)}" width="2.5" height="${rh}" fill="${charcoal}"/>`);
    for (let x = cx - bw / 2 + 30; x < cx + bw / 2 - 20; x += 60) rail.push(`<path d="M${f(x)} ${f(by - 18)}c0 -28 30 -28 30 -54c0 26 30 26 30 54" fill="none" stroke="${charcoal}" stroke-width="3"/><circle cx="${f(x + 30)}" cy="${f(by - 50)}" r="6" fill="none" stroke="${gold}" stroke-width="2" opacity="0.7"/>`);
    // Two pots of geraniums gone a little wild.
    for (const dx of [-120, 95]) {
      rail.push(`<path d="M${f(cx + dx)} ${f(by - 26)}h34l-5 24h-24z" fill="#9b5a3c"/>`);
      for (let i = 0; i < 26; i++) rail.push(`<circle cx="${f(cx + dx + 17 + random.range(-26, 26))}" cy="${f(by - 30 - random.range(0, 34))}" r="${f(random.range(4, 8))}" fill="${random.chance(0.25) ? '#a0423a' : jitter('#4f6238', random, 0.15)}"/>`);
    }
    house.push(`<g filter="url(#wobble)">${rail.join('')}</g>`);
  }

  // Ground floor: rusticated brick-red stone, the entrance, a small shop window with a dark frame.
  house.push(masonry(svg, random, { x: X0, y: floors[0], w: FW, h: ground - floors[0], unitW: 92, unitH: 38, mortar: shade(brick, -0.35), colours: [brick, shade(brick, 0.06), shade(brick, -0.06)], spread: 0.07, offset: 0.5, rough: 3 }));
  house.push(`<rect x="${X0}" y="${floors[0]}" width="${FW}" height="${ground - floors[0]}" fill="${svg.linear([[0, '#000', 0.25], [0.3, '#000', 0], [1, '#000', 0.2]])}"/>`);
  // Door with a round arch, panels and a gilded number.
  {
    const cx = X0 + step * 2.5;
    const dw = 170;
    const top = floors[0] + 46;
    house.push(`<path d="M${f(cx - dw / 2 - 26)} ${ground}V${f(top + 80)}A${f(dw / 2 + 26)} ${f(dw / 2 + 26)} 0 0 1 ${f(cx + dw / 2 + 26)} ${f(top + 80)}V${ground}Z" fill="${shade(plaster, 0.05)}"/>`);
    house.push(`<path d="M${f(cx - dw / 2)} ${ground}V${f(top + 80)}A${f(dw / 2)} ${f(dw / 2)} 0 0 1 ${f(cx + dw / 2)} ${f(top + 80)}V${ground}Z" fill="#3b2a20"/>`);
    house.push(pane(svg, random, { x: cx - dw / 2 + 12, y: top + 18, w: dw - 24, h: 60, glass, sky, lit: true, lights }));
    for (const side of [0, 1]) {
      const px = cx - dw / 2 + 10 + side * (dw / 2);
      house.push(`<rect x="${f(px)}" y="${f(top + 96)}" width="${f(dw / 2 - 20)}" height="80" fill="#4a3427" stroke="#2a1c14" stroke-width="3"/>`);
      house.push(`<rect x="${f(px)}" y="${f(top + 188)}" width="${f(dw / 2 - 20)}" height="${f(ground - top - 200)}" fill="#4a3427" stroke="#2a1c14" stroke-width="3"/>`);
    }
    house.push(`<rect x="${f(cx - 3)}" y="${f(top + 90)}" width="6" height="${f(ground - top - 90)}" fill="#22160f"/>`);
    house.push(`<circle cx="${f(cx + 20)}" cy="${f(top + 170)}" r="6" fill="${gold}"/>`);
    house.push(`<text x="${f(cx)}" y="${f(top + 10)}" font-family="Georgia, serif" font-size="30" fill="${gold}" text-anchor="middle">27</text>`);
  }
  // Small shop window on the left, a café curtain, a rolled awning.
  {
    const x = X0 + 90;
    const w = 330;
    const top = floors[0] + 70;
    house.push(`<rect x="${x - 14}" y="${top - 14}" width="${w + 28}" height="${ground - top}" fill="${charcoal}"/>`);
    house.push(pane(svg, random, { x, y: top, w, h: ground - top - 70, glass: '#30302d', sky, lit: true, lights }));
    house.push(`<rect x="${x}" y="${f(top + (ground - top - 70) * 0.55)}" width="${w}" height="${f((ground - top - 70) * 0.45)}" fill="#d8ccb2" opacity="0.6"/>`);
    house.push(`<rect x="${x - 26}" y="${top - 46}" width="${w + 52}" height="30" rx="14" fill="#5d3a2f"/>`);
    house.push(`<rect x="${x - 14}" y="${ground - 70}" width="${w + 28}" height="70" fill="${shade(charcoal, 0.08)}"/>`);
  }
  // Right: a plain ground-floor window with bars.
  {
    const x = X1 - 420;
    const w = 300;
    const top = floors[0] + 80;
    house.push(`<rect x="${x - 12}" y="${top - 12}" width="${w + 24}" height="190" fill="${shade(plaster, 0.04)}"/>`);
    house.push(pane(svg, random, { x, y: top, w, h: 166, glass, sky, curtain, lit: false, lights }));
    for (let bx = x + 20; bx < x + w; bx += 28) house.push(`<rect x="${bx}" y="${top}" width="3" height="166" fill="${charcoal}"/>`);
  }

  // Ivy climbing from the right corner of the ground floor and over the edge of the window.
  house.push(ivy(random, { x: X1 - 60, y: ground, height: 820, spread: 210, leaf: 15, tones: ['#3f5733', '#4d6a3c', '#344a2b', '#5b7444'], stem: '#3d3427', density: 1.1 }));
  // Paint the main house with the painterly wobble.
  svg.add(`<g filter="url(#wobble)">${house.join('')}</g>`);

  // ---- Street: Berlin paving (granite slabs in the middle, small mosaic stones at the sides), kerb.
  svg.add(`<rect x="-60" y="${ground}" width="${W + 120}" height="${H - ground + 60}" fill="#6f6a62"/>`);
  const street = [];
  for (let x = 0; x < W; x += 210) street.push(`<rect x="${x + 2}" y="${ground + 6}" width="206" height="66" fill="${jitter('#8f897e', random, 0.05)}"/>`);
  for (let i = 0; i < 1600; i++) street.push(`<rect x="${f(random.range(0, W))}" y="${f(random.range(ground + 76, H))}" width="${f(random.range(8, 14))}" height="${f(random.range(7, 11))}" rx="2" fill="${jitter('#7d776d', random, 0.12)}"/>`);
  street.push(`<rect x="0" y="${ground}" width="${W}" height="8" fill="#000" opacity="0.35"/>`);
  svg.add(`<g filter="url(#wobble)">${street.join('')}</g>`);
  // Old gas lamp in front of the left neighbour.
  {
    const lx = 420;
    const lamp = [];
    lamp.push(`<rect x="${lx - 9}" y="${ground - 600}" width="18" height="${600 + 60}" fill="#2d3330"/>`);
    lamp.push(`<rect x="${lx - 22}" y="${ground + 30}" width="44" height="34" fill="#2a2f2c"/>`);
    lamp.push(`<path d="M${lx - 40} ${ground - 600}h80l-14 -90h-52z" fill="#2d3330"/>`);
    lamp.push(`<path d="M${lx - 32} ${ground - 606}h64l-11 -76h-42z" fill="#e8dcb8" opacity="0.65"/>`);
    lamp.push(`<path d="M${lx - 50} ${ground - 690}h100l-50 -40z" fill="#2d3330"/>`);
    svg.add(`<g filter="url(#wobble)">${lamp.join('')}</g>`);
    lights.push({ x: lx - 30, y: ground - 680, w: 60, h: 72 });
  }

  // ---- Late sun from the left: the house across the street throws a long diagonal shadow over the
  // ground floor and the Beletage; the upper floors stay in warm light.
  svg.add(shadowShape([[-60, 1010], [700, 900], [1420, 1060], [2460, 760], [2460, H + 60], [-60, H + 60]], { opacity: 0.34, blur: 30, colour: '#26304a' }));
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="1000" fill="${svg.linear([[0, '#ffcf8a', 0.0], [0.6, '#ffcf8a', 0.16], [1, '#ffcf8a', 0]])}" style="mix-blend-mode:soft-light"/>`);
  // A linden in the foreground, out of focus: trunk at the left edge, its crown over the corner.
  {
    const tree = [];
    tree.push(`<path d="M120 ${H + 60}C150 1300 110 1000 170 760C200 640 260 560 330 470L360 500C300 590 250 680 236 780C214 960 250 1250 240 ${H + 60}Z" fill="#2a2620"/>`);
    tree.push(`<path d="M200 760C260 700 360 640 470 620L476 636C380 660 290 712 220 790Z" fill="#2a2620"/>`);
    tree.push(foliage(random, { cx: 150, cy: 210, rx: 470, ry: 300, tones: ['#3d4f2e', '#4a5f36', '#33432a', '#56683c'], leaf: 30, count: 950, lit: '#d6bf72' }));
    tree.push(foliage(random, { cx: 520, cy: 60, rx: 260, ry: 130, tones: ['#3d4f2e', '#4a5f36', '#56683c'], leaf: 26, count: 260, lit: '#d6bf72' }));
    svg.add(`<g filter="url(#blur6)" opacity="0.97">${tree.join('')}</g>`);
    // Dappled light through the crown onto the façade.
    const flecks = [];
    for (let i = 0; i < 70; i++) flecks.push(`<ellipse cx="${f(random.range(600, 1000))}" cy="${f(random.range(250, 800))}" rx="${f(random.range(8, 26))}" ry="${f(random.range(5, 14))}" fill="#fff1c9" opacity="${f(random.range(0.08, 0.22) * 100) / 100}"/>`);
    svg.add(`<g filter="url(#blur6)">${flecks.join('')}</g>`);
  }

  // ---- Atmosphere: haze at the street and the warm light of the afternoon from the left.
  svg.add(`<rect width="${W}" height="${H}" fill="${svg.linear([[0, '#f0e2c4', 0.14], [0.5, '#f0e2c4', 0], [1, '#3a3530', 0.25]], { x1: 0, y1: 0, x2: 1, y2: 0.4 })}"/>`);
  svg.add(`<rect y="${ground - 160}" width="${W}" height="${H - ground + 160}" fill="${svg.linear([[0, sky, 0], [0.5, sky, 0.18], [1, '#2b2825', 0.35]])}"/>`);
  // Finish: a painterly brush texture over the whole picture.
  // Edge darkening painted into the picture (the app adds its own adjustable vignette on top).
  svg.add(`<rect x="-60" y="-60" width="${W + 120}" height="${H + 120}" fill="${svg.radial([[0.55, '#000', 0], [1, '#000', 0.38]], { r: 0.75 })}"/>`);
  const flat = svg.body.join('');
  svg.body = [`<rect width="${W}" height="${H}" fill="${sky}"/>`, `<g filter="url(#brush)">${flat}</g>`, `<rect width="${W}" height="${H}" fill="#7a6a50" opacity="0.07" filter="url(#grain)"/>`];
  return { svg, lights, warm: '#ffc874' };
}
