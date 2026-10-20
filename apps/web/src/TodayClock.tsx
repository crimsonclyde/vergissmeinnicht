import { useEffect, useState } from 'react';
import { formatClock, t } from './i18n/index.ts';

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
  return (
    <section className="card today-card today-clock" aria-label={t('today.clock')} data-card="clock">
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
