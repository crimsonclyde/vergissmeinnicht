import { useId } from 'react';

/** Projected terminator, independent of the decorative surface. Waxing is lit on the right. */
export function lunarLightPath(fraction: number): string {
  const share = Math.max(0, Math.min(1, fraction));
  if (share === 0) return '';
  const radius = Math.abs(1 - 2 * share) * 80;
  return `M 0 -80 A 80 80 0 0 1 0 80 A ${radius || 0.001} 80 0 0 ${share < 0.5 ? 0 : 1} 0 -80 Z`;
}

/** Static, local vector art. Neither orbits nor surface markings participate in astronomy. */
export function CelestialArt({ fraction, waxing }: { fraction: number; waxing: boolean }) {
  const id = useId();
  return <svg className="celestial-art" viewBox="0 0 440 260" aria-hidden="true" focusable="false">
    <defs>
      <radialGradient id={`${id}-sun`} cx="38%" cy="35%"><stop stopColor="#fff2ad" /><stop offset=".4" stopColor="#ffc24a" /><stop offset=".85" stopColor="#e96a09" /><stop offset="1" stopColor="#ffbc45" /></radialGradient>
      <radialGradient id={`${id}-halo`}><stop offset=".5" stopColor="#f59726" stopOpacity=".26" /><stop offset="1" stopColor="#f59726" stopOpacity="0" /></radialGradient>
      <radialGradient id={`${id}-moon`} cx="70%" cy="25%"><stop stopColor="#eef4fc" /><stop offset=".65" stopColor="#9aacc2" /><stop offset="1" stopColor="#4c627e" /></radialGradient>
      <radialGradient id={`${id}-crater`}><stop stopColor="#26384e" stopOpacity=".7" /><stop offset=".8" stopColor="#52647b" stopOpacity=".3" /><stop offset="1" stopColor="#edf4ff" stopOpacity=".45" /></radialGradient>
      <filter id={`${id}-texture`} x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".065" numOctaves="3" seed="17" /><feColorMatrix type="saturate" values="0" /><feBlend in="SourceGraphic" mode="soft-light" /></filter>
      <filter id={`${id}-fire`} x="0" y="0" width="100%" height="100%"><feTurbulence type="turbulence" baseFrequency=".07" numOctaves="4" seed="9" /><feColorMatrix type="matrix" values="1.8 0 0 0 .15  1.3 0 0 0 -.35  .35 0 0 0 -.14  0 0 0 0 1" /><feBlend in="SourceGraphic" mode="multiply" /></filter>
      <clipPath id={`${id}-solar-disc`}><circle r="80" /></clipPath>
      <clipPath id={`${id}-light`}><path d={lunarLightPath(fraction)} transform={waxing ? undefined : 'scale(-1 1)'} /></clipPath>
    </defs>
    <circle cx="128" cy="130" r="130" fill={`url(#${id}-halo)`} />
    <g className="celestial-orbits" fill="none" strokeWidth=".65">
      {[128, 312].map(cx => <g key={cx}>
        <circle cx={cx} cy="130" r="94" /><circle cx={cx} cy="130" r="110" strokeDasharray="2 4" /><ellipse cx={cx} cy="130" rx="119" ry="121" />
        <path d={`M${cx - 118} 130h12m212 0h12M${cx} 10v9m0 222v9`} />
      </g>)}
      <path d="M220 2V258M18 130H422" />
      {[18, 220, 422].map(cx => <circle key={cx} cx={cx} cy="130" r="6" />)}
      {[16, 244].map(cy => <circle key={cy} cx="220" cy={cy} r="5" />)}
    </g>
    <g transform="translate(128 130)">
      <circle r="84" fill="none" stroke="#f7a93a" strokeWidth="2" opacity=".6" />
      <g clipPath={`url(#${id}-solar-disc)`}>
        <circle r="80" fill={`url(#${id}-sun)`} filter={`url(#${id}-fire)`} />

      </g>
      {Array.from({ length: 12 }, (_, i) => <path key={i} d="M-9 -81Q-16 -105 5 -88Q14 -83 19 -80" transform={`rotate(${i * 30})`} fill="none" stroke="#f5aa4b" strokeWidth=".8" opacity=".7" />)}
      <circle r="80" fill="none" stroke="#ffe1a0" strokeWidth="1.4" />
    </g>
    <g transform="translate(312 130)">
      <circle r="80" className="celestial-moon-dark" />
      <g clipPath={`url(#${id}-light)`}>
        <circle r="80" fill={`url(#${id}-moon)`} filter={`url(#${id}-texture)`} />
        {Array.from({ length: 37 }, (_, i) => <circle key={i} cx={Math.sin(i * 7.3) * (20 + i % 53)} cy={Math.cos(i * 3.7) * (20 + i % 55)} r={2 + i % 10} fill={`url(#${id}-crater)`} opacity=".4" />)}
      </g>
      <circle r="80" fill="none" stroke="#b8cce4" strokeWidth=".8" opacity=".75" />
    </g>
    <g className="celestial-orbit-points">{[18, 220, 422].map(cx => <circle key={cx} cx={cx} cy="130" r="2" />)}{[16, 244].map(cy => <circle key={cy} cx="220" cy={cy} r="2" />)}</g>
  </svg>;
}
