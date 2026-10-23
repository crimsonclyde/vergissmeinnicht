import { useEffect, useState } from 'react';
import { formatClock, t } from './i18n/index.ts';
import { useThemeMode } from './theme.ts';

/** The current minute, updated on the minute and when the page becomes visible again (a sleeping tab). */
function useMinute(): Date {
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

const ROMAN = ['XII', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'] as const;

/** A point on the dial: `turn` in twelfths of a circle from the top, clockwise. */
function onDial(turn: number, radius: number): [number, number] {
  const angle = (turn / 12) * 2 * Math.PI;
  return [Math.round((100 + Math.sin(angle) * radius) * 10) / 10, Math.round((100 - Math.cos(angle) * radius) * 10) / 10];
}

/**
 * The Witch Forest clock (25.1): an old stone sundial seen from above, moss on its rim and ivy creeping
 * over the edge. The gnomon's shadow points to the hour, a fainter one to the minute; by night the sun in
 * the middle becomes a moon. Pure decoration beside the time in words and digits (aria-hidden).
 */
export function Sundial({ now }: { now: Date }) {
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const hourTurn = (hours % 12) + minutes / 60;
  const night = hours < 6 || hours >= 18;
  return (
    <svg className="sundial" viewBox="0 0 200 200" aria-hidden="true" focusable="false" data-night={night}>
      <defs>
        <radialGradient id="sundial-stone" cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#56645a" />
          <stop offset="0.75" stopColor="#3a463e" />
          <stop offset="1" stopColor="#262f29" />
        </radialGradient>
        <radialGradient id="sundial-moss">
          <stop offset="0" stopColor="#5f7f47" stopOpacity="0.75" />
          <stop offset="1" stopColor="#5f7f47" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="sundial-bronze" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c9b27a" />
          <stop offset="0.55" stopColor="#8a7444" />
          <stop offset="1" stopColor="#4d4126" />
        </linearGradient>
        <filter id="sundial-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
      </defs>
      {/* The stone, its worn rim and patches of moss. */}
      <circle cx="100" cy="100" r="97" fill="#1b231e" />
      <circle cx="100" cy="100" r="94" fill="url(#sundial-stone)" />
      <ellipse cx="34" cy="150" rx="26" ry="18" fill="url(#sundial-moss)" />
      <ellipse cx="168" cy="58" rx="20" ry="14" fill="url(#sundial-moss)" />
      <ellipse cx="150" cy="168" rx="14" ry="10" fill="url(#sundial-moss)" />
      {/* Engraved rings, the minute marks and the hour lines. */}
      <g fill="none" stroke="#c8cfbd" strokeOpacity="0.55">
        <circle cx="100" cy="100" r="87" strokeWidth="0.8" />
        <circle cx="100" cy="100" r="65" strokeWidth="0.8" />
        <circle cx="100" cy="100" r="62" strokeWidth="0.4" />
        {Array.from({ length: 60 }, (_, index) => {
          const [x1, y1] = onDial(index / 5, 87);
          const [x2, y2] = onDial(index / 5, index % 5 === 0 ? 81 : 84);
          return <path key={index} d={`M${x1} ${y1}L${x2} ${y2}`} strokeWidth={index % 5 === 0 ? 1 : 0.5} />;
        })}
        {Array.from({ length: 24 }, (_, index) => {
          const [x1, y1] = onDial(index / 2, 62);
          const [x2, y2] = onDial(index / 2, index % 2 === 0 ? 30 : 50);
          return <path key={index} d={`M${x1} ${y1}L${x2} ${y2}`} strokeWidth={index % 2 === 0 ? 0.7 : 0.4} />;
        })}
      </g>
      <g className="sundial-numerals" fill="#e2dfcb" fontSize="13" textAnchor="middle" dominantBaseline="central">
        {ROMAN.map((numeral, index) => {
          const [x, y] = onDial(index, 74);
          return (
            <text key={numeral} x={x} y={y}>
              {numeral}
            </text>
          );
        })}
      </g>
      {/* The shadows: the hour reaching the numerals, the minute a fainter, longer line. */}
      <g className="sundial-shadow" filter="url(#sundial-soft)">
        <path d="M100 100L97 96L100 30L103 96Z" fill="#050806" fillOpacity="0.7" transform={`rotate(${minutes * 6} 100 100)`} />
        <path d="M100 106L92 96L100 48L108 96Z" fill="#020403" fillOpacity="0.92" transform={`rotate(${hourTurn * 30} 100 100)`} />
      </g>
      {/* The middle: an engraved sun by day, a crescent moon by night, under the bronze gnomon. */}
      <g className="sundial-centre" fill="none" stroke="#d9d4bb" strokeOpacity="0.7" strokeWidth="0.8">
        {night ? (
          <path d="M106 88A14 14 0 1 0 106 112A11 11 0 1 1 106 88Z" fill="#d9d4bb" fillOpacity="0.18" />
        ) : (
          <>
            <circle cx="100" cy="100" r="9" fill="#d9d4bb" fillOpacity="0.15" />
            {Array.from({ length: 16 }, (_, index) => {
              const [x1, y1] = onDial(index * 0.75, 12);
              const [x2, y2] = onDial(index * 0.75, index % 2 === 0 ? 20 : 16);
              return <path key={index} d={`M${x1} ${y1}L${x2} ${y2}`} />;
            })}
          </>
        )}
      </g>
      <path d="M100 100L96 103L100 70L104 103Z" fill="url(#sundial-bronze)" stroke="#2c2616" strokeWidth="0.6" />
      <circle cx="100" cy="100" r="3.2" fill="url(#sundial-bronze)" stroke="#2c2616" strokeWidth="0.6" />
      {/* Ivy creeping over the rim. */}
      <g fill="#24442d" stroke="#0f1d13" strokeWidth="0.4">
        <path d="M150 196Q166 176 186 168" fill="none" stroke="#1d3424" strokeWidth="1.5" />
        <path d="M160 184c-4 -3 -9 -1 -9 4c3 0 4 2 3 4c3 -1 5 0 6 3c1 -3 3 -4 6 -3c-1 -2 0 -4 3 -4c-1 -5 -5 -7 -9 -4z" />
        <path d="M176 172c-3 -3 -8 -1 -8 3c2 0 3 2 3 3c2 -1 4 0 5 2c1 -2 3 -3 5 -2c-1 -2 0 -3 2 -3c-1 -4 -4 -5 -7 -3z" />
        <path d="M188 166c-3 -2 -6 0 -6 3c2 0 2 1 2 2c2 -1 3 0 4 2c1 -2 2 -2 4 -2c-1 -1 0 -2 2 -2c-1 -3 -3 -4 -6 -3z" />
      </g>
    </svg>
  );
}
