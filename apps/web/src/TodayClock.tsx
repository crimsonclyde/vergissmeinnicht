import { useEffect, useId, useState } from 'react';
import { formatClock, t } from './i18n/index.ts';
import { useThemeMode } from './theme.ts';

/** The current minute, updated on the minute and when the page becomes visible again (a sleeping tab). */
export function useMinute(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      const current = new Date();
      setNow(current);
      timer = window.setTimeout(tick, 60_000 - (current.getSeconds() * 1000 + current.getMilliseconds()) + 50);
    };
    timer = window.setTimeout(tick, 60_000 - (new Date().getSeconds() * 1000 + new Date().getMilliseconds()) + 50);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      window.clearTimeout(timer);
      tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
}

/**
 * Clock & date (19.3): a personal card, off by default — the "home screen" feel on a desktop, laptop or wall
 * tablet; one line on a phone. Purely in the browser. Not a live region: nothing is announced each minute;
 * the `<time>` carries the full date and time as text for assistive technology.
 */
export function ClockCard({ hour24 }: { hour24: boolean }) {
  const now = useMinute();
  const { time, date, full } = formatClock(now, hour24);
  const [mode] = useThemeMode();
  return (
    <section className="card today-card today-clock" aria-label={t('today.clock')} data-card="clock">
      {mode === 'witch-forest' && <Sundial now={now} />}
      <time dateTime={now.toISOString().slice(0, 16)}>
        <span className="today-clock-time" aria-hidden="true">
          {/* Each digit is its own tile, keyed by its value: a changed digit is a new tile, which a theme
              may animate (Tokyo Nights flips it in). Other themes show plain text. */}
          {[...time].map((character, index) =>
            /\d/.test(character) ? (
              <span key={`${index}-${character}`} className="clock-digit">
                {character}
              </span>
            ) : (
              <span key={`s${index}`} className="clock-sep">
                {character}
              </span>
            ),
          )}
        </span>
        {/* The running minute as a thin bar (only drawn by themes that want it); restarts with each minute. */}
        <span key={now.getTime()} className="clock-minute" aria-hidden="true" style={{ animationDelay: `-${now.getSeconds() + now.getMilliseconds() / 1000}s` }} />
        <span className="today-clock-date" aria-hidden="true">
          {date}
        </span>
        <span className="visually-hidden">{full}</span>
      </time>
    </section>
  );
}

const SOLAR_HOURS = ['VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'I', 'II', 'III', 'IV', 'V', 'VI'] as const;

/** A point on the horizontal plate before its oblique projection. Noon is at the far edge. */
function onSundial(degrees: number, radius: number): [number, number] {
  const radians = degrees * Math.PI / 180;
  return [100 + Math.sin(radians) * radius, 100 - Math.cos(radians) * radius];
}

/**
 * A horizontal garden sundial viewed obliquely: the iron gnomon stays upright and fixed, while only
 * its cast shadow tells the time. The 24-hour shadow circle is an atmospheric convention, not solar
 * astronomy (including at night). Digital time remains authoritative. No continuously moving parts.
 */
export function Sundial({ now }: { now: Date }) {
  const id = useId();
  const angle = (now.getHours() + now.getMinutes() / 60 - 12) * 15;
  const [tipX, tipY] = onSundial(angle, 79);
  const radians = angle * Math.PI / 180;
  const crossX = Math.cos(radians);
  const crossY = Math.sin(radians);
  const shadow = (width: number) => `M${100 - crossX * width} ${100 - crossY * width}L${tipX - crossX} ${tipY - crossY}L${tipX + crossX} ${tipY + crossY}L${100 + crossX * width} ${100 + crossY * width}Z`;
  return (
    <svg className="sundial" viewBox="0 0 240 205" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-stone`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0" stopColor="var(--wf-dial-stone-light)" />
          <stop offset="1" stopColor="var(--wf-dial-stone)" />
        </linearGradient>
        <radialGradient id={`${id}-plate`} cx="0.35" cy="0.25" r="0.85">
          <stop offset="0" stopColor="var(--wf-dial-slate-light)" />
          <stop offset="0.7" stopColor="var(--wf-dial-slate)" />
          <stop offset="1" stopColor="var(--wf-dial-edge)" />
        </radialGradient>
        <linearGradient id={`${id}-iron`} x1="0" y1="0" x2="1" y2="0.6">
          <stop offset="0" stopColor="var(--wf-dial-patina)" />
          <stop offset="0.55" stopColor="var(--wf-dial-bronze)" />
          <stop offset="1" stopColor="var(--wf-dial-iron-light)" />
        </linearGradient>
        <pattern id={`${id}-grain`} width="31" height="29" patternUnits="userSpaceOnUse" patternTransform="rotate(13)">
          <g fill="var(--wf-dial-cut)">
            <ellipse cx="4" cy="5" rx="0.9" ry="0.5" opacity="0.5" />
            <ellipse cx="18" cy="12" rx="1.5" ry="0.7" opacity="0.3" />
            <ellipse cx="26" cy="24" rx="0.7" ry="1.1" opacity="0.45" />
            <circle cx="9" cy="23" r="0.5" opacity="0.6" />
            <circle cx="28" cy="8" r="0.4" opacity="0.5" />
          </g>
          <path d="M4 6l2 -0.5M17 13l3 -1M25 25l2 -1M11 16l2 0.4" stroke="var(--wf-dial-stone-light)" strokeWidth="0.5" opacity="0.55" />
          <path d="M6 15l3 -1M22 3l2 0.5M14 27l1 -1" stroke="var(--wf-dial-cut)" strokeWidth="0.45" opacity="0.4" />
        </pattern>
        <radialGradient id={`${id}-blood`} cx="0.37" cy="0.3" r="0.75">
          <stop offset="0" stopColor="var(--wf-dial-blood-light)" />
          <stop offset="0.45" stopColor="var(--wf-dial-blood)" />
          <stop offset="1" stopColor="var(--wf-dial-blood-dark)" />
        </radialGradient>
        <path id={`${id}-rune`} d="M100 114V147M100 116L89 125L100 133L111 124M100 134L91 143M100 138L108 146" />
        <clipPath id={`${id}-face`}><circle cx="100" cy="100" r="85" /></clipPath>
      </defs>
      {/* The plate lies on an irregular stone plinth: both share the same tilted ground plane. */}
      <g transform="matrix(.96 -.12 .15 .58 9 84)">
        <path d="M-1 107L2 82L12 53L32 29L58 12L92 5L126 9L156 22L181 47L197 77L203 110L195 139L175 167L147 188L113 199L78 197L47 185L21 163L6 136Z" fill="var(--wf-dial-shadow)" transform="translate(0 10)" />
        <path d="M-1 107L2 82L12 53L32 29L58 12L92 5L126 9L156 22L181 47L197 77L203 110L195 139L175 167L147 188L113 199L78 197L47 185L21 163L6 136Z" fill={`url(#${id}-stone)`} />
        <path d="M12 126L18 150L41 174M152 183L177 162L190 139M25 47L46 28L65 20M128 18L151 29" fill="none" stroke="var(--wf-dial-stone-light)" strokeWidth="2" opacity="0.45" />
        <circle cx="100" cy="103" r="90" fill="var(--wf-dial-shadow)" />
        <circle cx="100" cy="100" r="90" fill="var(--wf-dial-stone-light)" />
        <circle cx="100" cy="100" r="87" fill={`url(#${id}-plate)`} />
        <circle cx="100" cy="100" r="87" fill={`url(#${id}-grain)`} opacity="0.8" />
        {/* Chipped rim and hairline fractures, with the light edge of each recess. */}
        <path d="M18 72L25 76L29 84L37 88M168 48L162 57L164 65M150 174L143 166L145 155L139 149M56 177L61 170L58 164" fill="none" stroke="var(--wf-dial-stone-light)" strokeWidth="1.3" opacity="0.55" transform="translate(0.6 0.8)" />
        <path d="M18 72L25 76L29 84L37 88M168 48L162 57L164 65M150 174L143 166L145 155L139 149M56 177L61 170L58 164" fill="none" stroke="var(--wf-dial-cut)" strokeWidth="0.9" opacity="0.7" />
        <path d="M14 99L17 105L14 111M72 14L77 18L82 13M175 143L169 145L169 150M91 188L96 183L101 188" fill="none" stroke="var(--wf-dial-stone)" strokeWidth="3" />
        <circle cx="100" cy="100" r="84" fill="none" stroke="var(--wf-dial-stone-light)" strokeWidth="0.8" opacity="0.6" />
        <path d="M22 99A78 78 0 0 1 178 99M34 100A66 66 0 0 1 166 100" fill="none" stroke="var(--wf-dial-bronze)" strokeWidth="0.8" />
        {/* Daylight hours run from VI at the left to XII at the back and VI at the right. */}
        <g className="sundial-numerals" fill="var(--wf-dial-letter)" fontSize="11.5" textAnchor="middle" dominantBaseline="central">
          {SOLAR_HOURS.map((numeral, index) => {
            const degrees = (index - 6) * 15;
            const [x, y] = onSundial(degrees, 75);
            return <text key={index} x={x} y={y} transform={`rotate(${degrees} ${x} ${y})`}>{numeral}</text>;
          })}
        </g>
        <g stroke="var(--wf-dial-bronze)" strokeWidth="0.75" opacity="0.65">
          {SOLAR_HOURS.map((_, index) => {
            const degrees = (index - 6) * 15;
            const [x1, y1] = onSundial(degrees, 34);
            const [x2, y2] = onSundial(degrees, 64);
            return <path key={index} d={`M${x1} ${y1}L${x2} ${y2}`} />;
          })}
        </g>
        <g className="sundial-minor" stroke="var(--wf-dial-letter)" strokeWidth="0.6" opacity="0.45">
          {Array.from({ length: 25 }, (_, index) => {
            const [x1, y1] = onSundial((index - 12) * 7.5, 62);
            const [x2, y2] = onSundial((index - 12) * 7.5, 59);
            return <path key={index} d={`M${x1} ${y1}L${x2} ${y2}`} />;
          })}
        </g>
        {/* A fictional branch-like rune, cut into the near half of the stone. */}
        <g fill="none" strokeLinecap="square" strokeLinejoin="miter">
          <use href={`#${id}-rune`} stroke="var(--wf-dial-stone-light)" strokeWidth="2.3" opacity="0.65" transform="translate(0.8 1)" />
          <use href={`#${id}-rune`} stroke="var(--wf-dial-cut)" strokeWidth="2.2" opacity="0.9" />
          <path d="M40 128Q51 151 77 159M160 128Q149 151 123 159" stroke="var(--wf-dial-cut)" strokeWidth="0.8" opacity="0.45" />
        </g>
        {/* One small, still drop of blood on the stone; no animation or splatter. */}
        <path d="M132 142C132 148 124 154 125 160C126 169 140 170 141 160C142 154 135 149 132 142Z" fill="var(--wf-dial-blood-dark)" opacity="0.45" transform="translate(1 1.4)" />
        <path d="M132 142C132 148 125 154 126 160C127 167 139 168 140 160C141 154 135 149 132 142Z" fill={`url(#${id}-blood)`} />
        <path d="M130 153Q127 157 129 160" fill="none" stroke="var(--wf-dial-blood-glint)" strokeWidth="1" strokeLinecap="round" opacity="0.7" />
        {/* Small irregular scratches and patina, static and filter-free. */}
        <path className="sundial-minor" d="M27 112l7 2m-4 4l5 1M148 43l6 -2m-3 7l9 -3M118 170l8 -2m-4 5l11 -3M65 39l5 -3" fill="none" stroke="var(--wf-dial-patina)" strokeWidth="1.5" opacity="0.6" />
        <g clipPath={`url(#${id}-face)`}>
          <path className="sundial-time-shadow" d={shadow(8)} fill="var(--wf-dial-shadow)" opacity="0.18" />
          <path className="sundial-time-shadow" d={shadow(4)} fill="var(--wf-dial-shadow)" opacity="0.88" />
        </g>
        <ellipse cx="100" cy="100" rx="7" ry="4" fill="var(--wf-dial-shadow)" />
      </g>
      {/* A fixed raised iron fin, drawn in screen space so it stands above the horizontal face. */}
      <g className="sundial-gnomon">
        <path d="M120 130L142 27L147 28L150 113Z" fill="var(--wf-dial-shadow)" />
        <path d="M124 129L147 28L150 113Z" fill={`url(#${id}-iron)`} stroke="var(--wf-dial-bronze)" strokeWidth="0.7" />
        <path d="M124 129L147 28" stroke="var(--wf-dial-gold)" strokeWidth="1.3" opacity="0.7" />
        <path d="M132 115L145 62L145 108Z" fill="none" stroke="var(--wf-dial-patina)" strokeWidth="0.8" />
        <path d="M121 132L150 115L154 117L125 135Z" fill="var(--wf-dial-bronze)" />
      </g>
    </svg>
  );
}
