import { useEffect, useState } from 'react';
import { useMinute } from '../TodayClock.tsx';
import { formatClock, formatClockDate, t } from '../i18n/index.ts';
import { browserTimeZone } from '../schedule-dates.ts';
import { MobileActionBar, type MobileAction } from '../mobile/MobileActionBar.tsx';
import { useClockTools } from './ClockToolsProvider.tsx';
import { durationText, elapsedAt, idleTiming, pauseTiming, remainingAt, startTiming, validMinutes } from './clock-tools.ts';
import './instruments.css';

function ClockDial({ now, progress }: { now: Date | null; progress?: number }) {
  return <svg className="instrument-dial" viewBox="0 0 320 320" aria-hidden="true" focusable="false">
    <circle cx="160" cy="160" r="147" /><circle cx="160" cy="160" r="137" className="instrument-faint" />
    {Array.from({ length: 60 }, (_, index) => <line key={index} x1="160" y1={index % 5 === 0 ? 37 : 31} x2="160" y2="25" transform={`rotate(${index * 6} 160 160)`} className={index % 5 === 0 ? undefined : 'instrument-faint'} />)}
    <circle cx="160" cy="160" r="104" className="instrument-faint" />
    {now !== null && <><text x="160" y="61">XII</text><text x="262" y="165">III</text><text x="160" y="270">VI</text><text x="58" y="165">IX</text><line className="instrument-hour" x1="160" y1="160" x2="160" y2="89" transform={`rotate(${(now.getHours() % 12 + now.getMinutes() / 60) * 30} 160 160)`} /><line className="instrument-minute" x1="160" y1="160" x2="160" y2="65" transform={`rotate(${now.getMinutes() * 6} 160 160)`} /><circle cx="160" cy="160" r="5" className="instrument-pivot" /></>}
    {progress !== undefined && <circle className="instrument-timer-ring" cx="160" cy="160" r="128" pathLength="100" strokeDasharray="100" strokeDashoffset={100 * (1 - progress)} transform="rotate(-90 160 160)" />}
  </svg>;
}

export function ClockScreen({ hour24, onBack }: { hour24: boolean; onBack: () => void }) {
  const minute = useMinute();
  const { state, update } = useClockTools();
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
  const finished = remaining === 0;
  const running = timing.started !== null && !(mode === 'timer' && finished);
  const started = timing.started !== null || timing.elapsed > 0;
  const { time } = formatClock(minute, hour24);
  const date = formatClockDate(minute);
  const reading = mode === 'clock' ? time : durationText(mode === 'timer' ? remaining : elapsedAt(stopwatch, now));
  const zone = browserTimeZone();
  const status = mode === 'clock' ? t('clock.deviceTime') : mode === 'timer' && finished ? t('clock.finished') : running ? t('clock.running') : started ? t('clock.paused') : t('clock.ready');
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
  return <section className="applet-screen stack" aria-labelledby="clock-heading">
    <header><h1 id="clock-heading">{t('today.clock')}</h1><p className="muted">{date}</p></header>
    <div className="segmented clock-modes" role="group" aria-label={t('clock.mode')}>
      {(['clock', 'stopwatch', 'timer'] as const).map(value => <button key={value} type="button" aria-pressed={mode === value} onClick={() => { update({ mode: value }); setNow(Date.now()); }}>{t(`clock.mode.${value}`)}</button>)}
    </div>
    <div className="instrument instrument-clock">
      <header className="instrument-heading"><span>{t(`clock.eyebrow.${mode}`)}</span><h2>{t(`clock.title.${mode}`)}</h2><i aria-hidden="true" /></header>
      <div className={`instrument-timepiece${mode === 'clock' ? '' : ' instrument-timing'}`}>
        <ClockDial now={mode === 'clock' ? minute : null} {...(mode === 'timer' ? { progress: remaining / duration } : {})} />
        <div className="instrument-digital"><span className="instrument-time" data-long={reading.length > 5}>{reading}</span><span className="instrument-caption">{status}</span></div>
      </div>
      {mode === 'clock' && <dl className="instrument-clock-meta"><div><dt>{t('clock.date')}</dt><dd>{date}</dd></div><div><dt>{t('clock.deviceZone')}</dt><dd>{zone}</dd><dd>{t('clock.zoneOffset', { offset: -minute.getTimezoneOffset() / 60 })}</dd></div></dl>}
      {mode === 'timer' && <div className="instrument-duration"><div className="instrument-presets" role="group" aria-label={t('clock.presets')}>{[5, 15, 25, 60].map(value => <button key={value} type="button" aria-pressed={minutes === value} disabled={started} onClick={() => setMinutes(value)}>{t('clock.minutes', { count: value })}</button>)}</div><label htmlFor="timer-minutes">{t('clock.customMinutes')}</label><input id="timer-minutes" type="number" min="1" max="1440" step="1" value={draft} disabled={started} aria-invalid={invalid} onChange={event => { setDraft(event.target.value); const value = Number(event.target.value); setInvalid(!validMinutes(value)); if (validMinutes(value)) update({ minutes: value }); }} onBlur={() => { if (validMinutes(Number(draft))) setMinutes(Number(draft)); }} />{invalid && <p role="alert">{t('clock.invalidMinutes')}</p>}</div>}
      {mode === 'stopwatch' && <div className="instrument-laps"><h3>{t('clock.laps')}</h3>{laps.length === 0 ? <p>{t('clock.noLaps')}</p> : <ol>{laps.map((lap, index) => <li key={index}><span>{t('clock.lapNumber', { number: index + 1 })}</span><span>{durationText(lap)}</span></li>)}</ol>}{laps.length === 100 && <p>{t('clock.lapLimit')}</p>}</div>}
      <p className="instrument-poem">{t(`clock.note.${mode}`)}</p>
    </div>
    {mode !== 'clock' && <p className="muted">{t('clock.ephemeral')}</p>}
    <p role="status">{mode === 'timer' && finished ? t('clock.finished') : ''}</p>
    <MobileActionBar label={t('clock.actions')} actions={actions} {...(mode === 'clock' ? {} : { primary: { id: 'start-pause', icon: running ? 'pause' as const : 'preview' as const, label: running ? t('clock.pause') : started && !(mode === 'timer' && finished) ? t('clock.resume') : t('clock.start'), disabled: mode === 'timer' && (invalid || !validMinutes(Number(draft))), onClick: startPause } })} />
  </section>;
}
