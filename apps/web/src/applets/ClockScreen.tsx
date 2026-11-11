import { useEffect, useState, type CSSProperties } from 'react';
import { useMinute } from '../TodayClock.tsx';
import { formatClock, formatNumber, formatWallTime, t } from '../i18n/index.ts';
import { browserTimeZone } from '../schedule-dates.ts';
import { MobileActionBar, type MobileAction } from '../mobile/MobileActionBar.tsx';
import { UiIcon } from '../ui-icons.tsx';
import clockArtwork from './art/clock.webp';
import { useClockTools } from './ClockToolsProvider.tsx';
import { durationText, elapsedAt, idleTiming, pauseTiming, remainingAt, startTiming, validMinutes } from './clock-tools.ts';
import { hourOfDay, hoursMinutes, isoWeek, utcOffset, wallHour, zoneCity } from './clock-view.ts';
import { useForecast } from './ForecastProvider.tsx';
import { Readings, type Reading } from './Readings.tsx';
import './instruments.css';
import './clock-screen.css';

/** Where the painted watch's dial centre sits, in the 1000-unit square the artwork is drawn in (same as the Today card). */
const DIAL = { x: 508, y: 406 };

/**
 * The painted pocket watch of the Today card. The clock shows its hour and minute hands; the stopwatch and timer
 * show one sweeping hand and a gold ring that fills (stopwatch: each minute, timer: the set duration).
 */
function Watch({ now, sweep, progress }: { now?: Date; sweep?: number; progress?: number }) {
  return <span className="clock-watch" aria-hidden="true">
    <img src={clockArtwork} alt="" width={700} height={700} draggable={false} />
    <svg viewBox="0 0 1000 1000" focusable="false">
      {progress !== undefined && <>
        <circle className="clock-ring-track" cx={DIAL.x} cy={DIAL.y} r="218" />
        <circle className="clock-ring" cx={DIAL.x} cy={DIAL.y} r="218" pathLength="100" strokeDasharray="100" strokeDashoffset={100 * (1 - Math.min(1, Math.max(0, progress)))} transform={`rotate(-90 ${DIAL.x} ${DIAL.y})`} />
      </>}
      <g transform={`translate(${DIAL.x} ${DIAL.y})`}>
        {now !== undefined && <>
          <line className="clock-hand clock-hand-hour" x1="0" y1="22" x2="0" y2="-120" transform={`rotate(${(now.getHours() % 12 + now.getMinutes() / 60) * 30})`} />
          <line className="clock-hand clock-hand-minute" x1="0" y1="26" x2="0" y2="-175" transform={`rotate(${now.getMinutes() * 6})`} />
        </>}
        {sweep !== undefined && <line className="clock-hand clock-hand-sweep" x1="0" y1="30" x2="0" y2="-182" transform={`rotate(${sweep})`} />}
        <circle className="clock-pivot" r="11" />
      </g>
    </svg>
  </span>;
}

/** Today from midnight to midnight as a sky: night, dawn, day, dusk; the part already gone is dimmed, "now" marked. */
function DayStrip({ now, sun }: { now: Date; sun: { rise: number; set: number } | null }) {
  const at = (hour: number) => `${(hour / 24) * 100}%`;
  const share = hourOfDay(now) / 24;
  const style = (sun === null ? {} : { '--rise': at(sun.rise), '--set': at(sun.set) }) as CSSProperties;
  const daylight = sun === null ? null : hoursMinutes((sun.set - sun.rise) * 60);
  const nowHour = hourOfDay(now);
  const left = sun !== null && nowHour > sun.rise && nowHour < sun.set ? hoursMinutes((sun.set - nowHour) * 60) : null;
  return <section className="card clock-day" aria-labelledby="clock-day-heading">
    <h2 id="clock-day-heading" className="clock-eyebrow">{t('clock.today')}</h2>
    <div className={`clock-day-strip${sun === null ? ' is-plain' : ''}`} style={style} role="img" aria-label={t('clock.dayPassed', { percent: Math.round(share * 100) })}>
      <span className="clock-day-past" style={{ width: `${share * 100}%` }} />
      <span className="clock-day-now" style={{ left: `${share * 100}%` }} />
    </div>
    <ol className="clock-day-axis" aria-hidden="true">{[0, 6, 12, 18, 24].map((hour) => <li key={hour} style={{ left: at(hour) }}>{hour}</li>)}</ol>
    {daylight !== null && <p className="clock-note">
      {t('clock.daylight', daylight)}
      {left !== null && <> · {t('clock.daylightLeft', left)}</>}
    </p>}
  </section>;
}

export function ClockScreen({ hour24, onBack }: { hour24: boolean; onBack: () => void }) {
  const minute = useMinute();
  const { state, update } = useClockTools();
  const { data: weather } = useForecast();
  const { mode, stopwatch, timer, minutes, laps } = state;
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState(String(minutes));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const handle = window.setInterval(tick, 250);
    document.addEventListener('visibilitychange', tick);
    return () => { window.clearInterval(handle); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const timing = mode === 'timer' ? timer : stopwatch;
  const duration = minutes * 60_000;
  const remaining = remainingAt(timer, duration, now);
  const elapsed = elapsedAt(stopwatch, now);
  const finished = remaining === 0;
  const running = timing.started !== null && !(mode === 'timer' && finished);
  const started = timing.started !== null || timing.elapsed > 0;
  const { time, date } = formatClock(minute, hour24);
  const reading = mode === 'clock' ? time : durationText(mode === 'timer' ? remaining : elapsed);
  const zone = browserTimeZone();
  const status = mode === 'clock' ? t('clock.now') : mode === 'timer' && finished ? t('clock.finished') : running ? t('clock.running') : started ? t('clock.paused') : t('clock.ready');

  // Sunrise and sunset come from the forecast already loaded for Today, and only when its place keeps this device's time.
  const today = weather?.forecast.days[0];
  const sameDay = today !== undefined && weather?.location.timeZone === zone && today.date === localDate(minute);
  const sun = sameDay && today.sunrise !== undefined && today.sunset !== undefined ? { rise: wallHour(today.sunrise), set: wallHour(today.sunset), riseText: today.sunrise, setText: today.sunset } : null;
  const week = isoWeek(minute);
  const offset = utcOffset(minute.getTimezoneOffset());
  const readings: Reading[] = [
    { id: 'zone', icon: 'timeZone', label: t('clock.deviceZone'), value: 'UTC', unit: offset, info: zone },
    { id: 'week', icon: 'week', label: t('clock.weekLabel'), value: t('clock.week'), unit: String(week), info: t('clock.weekInfo', { week, year: minute.getFullYear() }) },
    ...(sun === null ? [] : [
      { id: 'sunrise', icon: 'sunrise' as const, label: t('clock.sunrise'), value: formatWallTime(sun.riseText), info: t('clock.sunInfo', { place: weather?.location.name ?? '' }) },
      { id: 'sunset', icon: 'sunset' as const, label: t('clock.sunset'), value: formatWallTime(sun.setText), info: t('clock.sunInfo', { place: weather?.location.name ?? '' }) },
    ]),
  ];

  const startPause = () => {
    const instant = Date.now();
    const next = running ? pauseTiming(timing, instant) : startTiming(mode === 'timer' && remainingAt(timer, duration, instant) === 0 ? idleTiming() : timing, instant);
    update(mode === 'timer' ? { timer: next } : { stopwatch: next });
    setNow(instant);
  };
  const setMinutes = (value: number) => { update({ minutes: value, timer: idleTiming() }); setDraft(String(value)); setInvalid(false); };
  const actions: MobileAction[] = [{ id: 'back', icon: 'back', label: t('common.back'), onClick: onBack }];
  if (mode !== 'clock') actions.push({ id: 'reset', icon: 'reset', label: t('clock.reset'), disabled: running || !started, onClick: () => { update(mode === 'timer' ? { timer: idleTiming() } : { stopwatch: idleTiming(), laps: [] }); setNow(Date.now()); } });
  if (mode === 'stopwatch') actions.push({ id: 'lap', icon: 'lap', label: t('clock.lap'), disabled: !running || laps.length >= 100, onClick: () => update({ laps: [...laps, elapsedAt(stopwatch, Date.now())] }) });

  return <section className="applet-screen clock-page" aria-labelledby="clock-heading">
    <div className="clock-heading-row">
      <h1 id="clock-heading">{t('today.clock')}</h1>
      <div className="segmented clock-modes" role="group" aria-label={t('clock.mode')}>
        {(['clock', 'stopwatch', 'timer'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} aria-label={t(`clock.mode.${value}`)} title={t(`clock.mode.${value}`)} onClick={() => { update({ mode: value }); setNow(Date.now()); }}><UiIcon name={value} /></button>)}
      </div>
    </div>
    <div className="clock-body">
      <section className="card clock-hero" aria-labelledby="clock-hero-heading">
        {mode === 'clock' ? <Watch now={minute} />
          : mode === 'timer' ? <Watch sweep={(1 - remaining / duration) * 360} progress={1 - remaining / duration} />
          : <Watch sweep={(elapsed % 60_000) / 60_000 * 360} progress={(elapsed % 3_600_000) / 3_600_000} />}
        <div className="clock-hero-content">
          <p className="clock-eyebrow" id="clock-hero-heading">
            <span>{mode === 'clock' ? zoneCity(zone) : t(`clock.mode.${mode}`)}</span> · <span className="clock-status">{status}</span>
          </p>
          <p className="clock-time" data-long={reading.length > 5}>{reading}</p>
          {mode === 'clock' && <p className="clock-sub">{date}</p>}
          {mode === 'timer' && <p className="clock-sub">{t('clock.ofMinutes', { count: minutes })}</p>}
        </div>
        {mode === 'clock' && <Readings readings={readings} label={t('clock.details')} />}
      </section>

      {mode === 'clock' && <DayStrip now={minute} sun={sun} />}

      {mode === 'timer' && <section className="card clock-panel" aria-labelledby="clock-presets-heading">
        <h2 id="clock-presets-heading" className="clock-eyebrow">{t('clock.presets')}</h2>
        <div className="clock-presets" role="group" aria-labelledby="clock-presets-heading">
          {[5, 15, 25, 60].map(value => <button key={value} type="button" className="reading" aria-pressed={minutes === value} disabled={started} onClick={() => setMinutes(value)}>
            <span className="reading-value">{formatNumber(value)}<small>{t('clock.min')}</small></span>
          </button>)}
        </div>
        <div className="clock-custom">
          <label htmlFor="timer-minutes">{t('clock.customMinutes')}</label>
          <input id="timer-minutes" type="number" min="1" max="1440" step="1" value={draft} disabled={started} aria-invalid={invalid} onChange={event => { setDraft(event.target.value); const value = Number(event.target.value); setInvalid(!validMinutes(value)); if (validMinutes(value)) update({ minutes: value }); }} onBlur={() => { if (validMinutes(Number(draft))) setMinutes(Number(draft)); }} />
          {invalid && <p role="alert">{t('clock.invalidMinutes')}</p>}
        </div>
      </section>}

      {mode === 'stopwatch' && <section className="card clock-panel clock-laps" aria-labelledby="clock-laps-heading">
        <h2 id="clock-laps-heading" className="clock-eyebrow">{t('clock.laps')}</h2>
        {laps.length === 0 ? <p className="clock-note">{t('clock.noLaps')}</p> : <ol>{laps.map((lap, index) => <li key={index}><span className="clock-lap-number">{t('clock.lapNumber', { number: index + 1 })}</span><span>{durationText(lap)}</span></li>)}</ol>}
        {laps.length === 100 && <p className="clock-note">{t('clock.lapLimit')}</p>}
      </section>}
    </div>
    {mode !== 'clock' && <p className="clock-note clock-ephemeral">{t('clock.ephemeral')}</p>}
    <p role="status" className="visually-hidden">{mode === 'timer' && finished ? t('clock.finished') : ''}</p>
    <MobileActionBar label={t('clock.actions')} actions={actions} {...(mode === 'clock' ? {} : { primary: { id: 'start-pause', icon: running ? 'pause' as const : 'preview' as const, label: running ? t('clock.pause') : started && !(mode === 'timer' && finished) ? t('clock.resume') : t('clock.start'), disabled: mode === 'timer' && (invalid || !validMinutes(Number(draft))), onClick: startPause } })} />
  </section>;
}

/** The device's local calendar date `YYYY-MM-DD`. */
function localDate(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
