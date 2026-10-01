import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { api, isNetworkError, messageFor, type CalendarRange, type PersonRef } from './api.ts';
import {
  DEFAULT_FILTERS,
  STATUS_FILTERS,
  STATUS_GLYPH,
  addMonths,
  dayAfterKey,
  entriesOf,
  lastDayOf,
  matches,
  monthGrid,
  monthOf,
  parseFilters,
  responsiblePeople,
  scheduleOf,
  type CalendarEntry,
  type CalendarFilters,
  type StatusFilter,
} from './calendar-model.ts';
import { DoneItem, OccurrenceItem, type Capabilities } from './Home.tsx';
import { formatCalendarDate, formatMonth, t, weekdayNames } from './i18n/index.ts';
import { useOffline } from './offline/OfflineProvider.tsx';
import { AppIcon } from './procedure-icons.tsx';
import { browserTimeZone, todayIn } from './schedule-dates.ts';
import { recurrenceLabel } from './ScheduleDialog.tsx';

/** Other members' changes appear without reloading, like on Home. */
const REFRESH_MS = 30_000;
const FILTERS_KEY = 'vmn.calendarFilters';
const VIEW_KEY = 'vmn.calendarView';
/** Entries named in a day cell of the month view; the rest are counted. */
const CHIPS_PER_DAY = 3;
type View = 'MONTH' | 'AGENDA';

/** Remembered per viewer (a convenience, nothing else); the agenda is the default on narrow screens. */
function storedView(): View {
  try {
    const value = window.localStorage.getItem(VIEW_KEY);
    if (value === 'MONTH' || value === 'AGENDA') return value;
  } catch {
    /* fall through to the default */
  }
  return typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 40rem)').matches ? 'AGENDA' : 'MONTH';
}

function storedFilters(): CalendarFilters {
  try {
    return parseFilters(window.localStorage.getItem(FILTERS_KEY));
  } catch {
    return parseFilters(null);
  }
}

function remember(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* per-viewer convenience only */
  }
}

/** A planned date of a repeating series: shown with its details, with nothing to act on yet. */
function ProjectedItem({ entry }: { entry: Extract<CalendarEntry, { status: 'PROJECTED' }> }) {
  const { schedule, responsible } = entry.projected;
  const date = formatCalendarDate(entry.date);
  return (
    <li className="card home-item calendar-projected">
      <div>
        <strong>
          <AppIcon name={schedule.procedure?.icon ?? 'reminder'} /> {schedule.title}
        </strong>
        <br />
        <small className="muted">
          <span aria-hidden="true">{STATUS_GLYPH.PROJECTED} </span>
          {t('calendar.planned', { when: entry.time === null ? date : t('home.dateTime', { date, time: entry.time }) })}
          {' · '}
          {t(schedule.kind === 'PROCEDURE' ? 'home.kindProcedure' : 'home.kindReminder')}
          {' · '}
          {recurrenceLabel(schedule.recurrence)}
        </small>
        <br />
        <small className="muted">{responsible === null ? t('home.shared') : t('home.assignedTo', { name: responsible.name })}</small>
        <br />
        <small className="muted">{t('calendar.plannedHint')}</small>
      </div>
    </li>
  );
}

/**
 * Calendar and agenda (14.4): the Occurrences of one month — the same ones Home shows, with the same
 * actions — plus planned dates of repeating series. Month view by default, an agenda on narrow screens.
 * Read-only towards the server apart from those actions: no drag-and-drop, no external calendars.
 */
export function Calendar(props: { workspaceId: string; userId: string; canStart: boolean; canSchedule: boolean; canExecute: boolean; onOpenRun: (runId: string) => void }) {
  const { workspaceId } = props;
  const { reportReachable, reportUnreachable } = useOffline();
  const today = todayIn(browserTimeZone());
  const [month, setMonth] = useState(() => monthOf(today));
  const [selected, setSelected] = useState(today);
  const [view, setView] = useState<View>(storedView);
  const [filters, setFilters] = useState<CalendarFilters>(storedFilters);
  const filtering = filters.statuses.length !== DEFAULT_FILTERS.statuses.length || filters.responsible !== DEFAULT_FILTERS.responsible || filters.type !== DEFAULT_FILTERS.type;
  /** Folded away until used, so the dates come first — but open when a remembered filter hides entries. */
  const [filtersOpen, setFiltersOpen] = useState(filtering);
  const [range, setRange] = useState<CalendarRange | null>(null);
  const [members, setMembers] = useState<readonly PersonRef[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Set by keyboard navigation: the day button that gets the focus once it is rendered. */
  const focusDay = useRef<string | null>(null);
  const latestRequest = useRef(0);
  const gridRef = useRef<HTMLTableElement>(null);

  const weeks = useMemo(() => monthGrid(month), [month]);
  const from = weeks[0]?.[0] ?? `${month}-01`;
  const to = weeks[weeks.length - 1]?.[6] ?? lastDayOf(month);

  const load = useCallback(() => {
    const request = ++latestRequest.current;
    api.calendar(workspaceId, from, to).then(
      (loaded) => {
        // A slower answer for a month left meanwhile must not replace the current one.
        if (request !== latestRequest.current) return;
        setRange(loaded);
        setMessage(null);
        reportReachable();
      },
      (caught: unknown) => {
        if (request !== latestRequest.current) return;
        if (isNetworkError(caught)) reportUnreachable();
        setMessage(messageFor(caught));
      },
    );
  }, [workspaceId, from, to, reportReachable, reportUnreachable]);
  useEffect(load, [load]);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') load();
    };
    const timer = window.setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);
  useEffect(() => {
    if (!props.canSchedule) return;
    api.members(workspaceId).then(
      (list) => setMembers(list.map((member) => ({ id: member.userId, name: member.displayName }))),
      () => setMembers(null),
    );
  }, [workspaceId, props.canSchedule]);
  useEffect(() => {
    if (focusDay.current === null) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`button[data-date="${focusDay.current}"]`)?.focus();
    focusDay.current = null;
  });

  const loaded = range !== null && range.from === from && range.to === to ? range : null;
  const all = useMemo(() => (loaded === null ? [] : entriesOf(loaded)), [loaded]);
  const people = useMemo(() => responsiblePeople(all), [all]);
  // A remembered person who is responsible for nothing in this month is not offered — and not applied.
  const personKnown = ['ALL', 'MINE', 'SHARED'].includes(filters.responsible) || people.some((person) => person.id === filters.responsible);
  const effective = useMemo(() => (personKnown ? filters : { ...filters, responsible: 'ALL' }), [filters, personKnown]);
  const byDay = useMemo(() => {
    const days = new Map<string, CalendarEntry[]>();
    for (const entry of all) {
      if (matches(entry, effective, props.userId)) days.set(entry.date, [...(days.get(entry.date) ?? []), entry]);
    }
    return days;
  }, [all, effective, props.userId]);

  const changeFilters = (next: CalendarFilters) => {
    setFilters(next);
    remember(FILTERS_KEY, JSON.stringify(next));
  };
  const toggleStatus = (status: StatusFilter) =>
    changeFilters({ ...filters, statuses: STATUS_FILTERS.filter((value) => (value === status ? !filters.statuses.includes(value) : filters.statuses.includes(value))) });
  const chooseView = (next: View) => {
    setView(next);
    remember(VIEW_KEY, next);
  };
  const showDay = (date: string) => {
    setSelected(date);
    setMonth(monthOf(date));
  };
  const showMonth = (next: string) => {
    setMonth(next);
    // Keep the day of the month where it exists (the 31st becomes the month's last day).
    const day = `${next}-${selected.slice(8)}`;
    setSelected(next === monthOf(today) ? today : day > lastDayOf(next) ? lastDayOf(next) : day);
  };
  const onDayKey = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const next = event.key === 'PageUp' ? `${addMonths(monthOf(date), -1)}-01` : event.key === 'PageDown' ? `${addMonths(monthOf(date), 1)}-01` : dayAfterKey(date, event.key);
    if (next === null) return;
    event.preventDefault();
    focusDay.current = next;
    showDay(next);
  };

  const can: Capabilities = { canStart: props.canStart, canSchedule: props.canSchedule, canExecute: props.canExecute };
  const row = (entry: CalendarEntry) =>
    entry.status === 'PROJECTED' ? (
      <ProjectedItem key={entry.key} entry={entry} />
    ) : entry.status === 'COMPLETED' || entry.status === 'SKIPPED' ? (
      <DoneItem key={entry.key} workspaceId={workspaceId} item={entry.occurrence} can={can} onChanged={load} exact />
    ) : (
      <OccurrenceItem key={entry.key} workspaceId={workspaceId} item={entry.occurrence} older={[]} can={can} members={members} onOpenRun={props.onOpenRun} onChanged={load} />
    );
  const dayHeading = (date: string) => (date === today ? `${t('calendar.today')} · ${formatCalendarDate(date)}` : formatCalendarDate(date));
  const dayLabel = (date: string, count: number) => (count === 0 ? t('calendar.dayNone', { date: dayHeading(date) }) : t('calendar.day', { date: dayHeading(date), count }));
  const agendaDays = [...byDay.keys()].filter((date) => monthOf(date) === month).sort();
  const selectedEntries = byDay.get(selected) ?? [];
  const shortDays = weekdayNames('short');
  const longDays = weekdayNames('long');

  return (
    <section aria-labelledby="calendar-heading" className="calendar">
      <div className="page-header">
        <h2 id="calendar-heading">{t('calendar.heading')}</h2>
        <div className="row home-filter" role="group" aria-label={t('calendar.view')}>
          {(['MONTH', 'AGENDA'] as const).map((value) => (
            <button key={value} type="button" className="quiet" aria-pressed={view === value} onClick={() => chooseView(value)}>
              {view === value && <span aria-hidden="true">✓ </span>}
              {t(`calendar.view.${value}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="calendar-nav">
        <button type="button" aria-label={t('calendar.previous')} onClick={() => showMonth(addMonths(month, -1))}>
          <span aria-hidden="true">‹</span>
        </button>
        <h3 id="calendar-month" aria-live="polite">
          {formatMonth(month)}
        </h3>
        <button type="button" aria-label={t('calendar.next')} onClick={() => showMonth(addMonths(month, 1))}>
          <span aria-hidden="true">›</span>
        </button>
        <button type="button" className="quiet" disabled={month === monthOf(today) && selected === today} onClick={() => showDay(today)}>
          {t('calendar.today')}
        </button>
      </div>
      <details className="calendar-filter-box" open={filtersOpen} onToggle={(event) => setFiltersOpen(event.currentTarget.open)}>
        <summary>{filtering ? t('calendar.filtersActive') : t('calendar.filters')}</summary>
        <div className="calendar-filters">
          <fieldset>
            <legend>{t('home.filter')}</legend>
            {STATUS_FILTERS.map((status) => (
              <label key={status}>
                <input type="checkbox" checked={filters.statuses.includes(status)} onChange={() => toggleStatus(status)} />
                <span aria-hidden="true">{STATUS_GLYPH[status]} </span>
                {t(`calendar.status.${status}`)}
              </label>
            ))}
          </fieldset>
          <label>
            {t('schedule.responsible')}
            <select value={effective.responsible} onChange={(e) => changeFilters({ ...filters, responsible: e.target.value })}>
              <option value="ALL">{t('calendar.anyone')}</option>
              <option value="MINE">{t('home.filter.MINE')}</option>
              <option value="SHARED">{t('home.filter.SHARED')}</option>
              {people
                .filter((person) => person.id !== props.userId)
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            {t('calendar.type')}
            <select value={filters.type} onChange={(e) => changeFilters({ ...filters, type: e.target.value as CalendarFilters['type'] })}>
              {(['ALL', 'REMINDER', 'PROCEDURE'] as const).map((value) => (
                <option key={value} value={value}>
                  {t(`calendar.type.${value}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>
      {message !== null && <p role="alert">{message}</p>}
      {loaded === null && message === null && <p role="status">{t('common.loading')}</p>}
      {loaded?.truncated === true && <p role="note">{t('calendar.truncated')}</p>}

      {/* The grid stays while another month loads, so keyboard focus is never lost. */}
      {view === 'MONTH' && (
        <>
          <table className="calendar-grid" ref={gridRef} aria-labelledby="calendar-month" aria-busy={loaded === null}>
            <thead>
              <tr>
                {shortDays.map((name, index) => (
                  <th key={name} scope="col" abbr={longDays[index]}>
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {weeks.map((week) => (
                <tr key={week[0]}>
                  {week.map((date) => {
                    const entries = byDay.get(date) ?? [];
                    return (
                      <td key={date}>
                        <button
                          type="button"
                          className={`calendar-day${monthOf(date) === month ? '' : ' calendar-outside'}`}
                          data-date={date}
                          aria-label={dayLabel(date, entries.length)}
                          aria-pressed={date === selected}
                          aria-current={date === today ? 'date' : undefined}
                          tabIndex={date === selected ? 0 : -1}
                          onClick={() => showDay(date)}
                          onKeyDown={(event) => onDayKey(event, date)}
                        >
                          <span className="calendar-day-number">{Number(date.slice(8))}</span>
                          {entries.slice(0, CHIPS_PER_DAY).map((entry) => (
                            <span key={entry.key} className="calendar-chip" data-status={entry.status}>
                              <span className="calendar-chip-glyph">{STATUS_GLYPH[entry.status]}</span>
                              <span className="calendar-chip-title"> {scheduleOf(entry).title}</span>
                            </span>
                          ))}
                          {entries.length > CHIPS_PER_DAY && <span className="calendar-chip calendar-more">{t('calendar.more', { count: entries.length - CHIPS_PER_DAY })}</span>}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <section aria-labelledby="calendar-day-heading" className="home-section">
            <h3 id="calendar-day-heading" aria-live="polite">
              {dayHeading(selected)}
            </h3>
            {loaded === null ? null : selectedEntries.length === 0 ? (
              <p className="muted">{t('calendar.nothingOnDay')}</p>
            ) : (
              <ul className="plain-list" aria-labelledby="calendar-day-heading">
                {selectedEntries.map(row)}
              </ul>
            )}
          </section>
        </>
      )}

      {loaded !== null && view === 'AGENDA' && (
        <div className="calendar-agenda">
          {agendaDays.length === 0 && <p className="card">{t('calendar.nothingInMonth', { month: formatMonth(month) })}</p>}
          {agendaDays.map((date) => (
            <section key={date} aria-labelledby={`agenda-${date}`} className="home-section">
              <h3 id={`agenda-${date}`}>{dayHeading(date)}</h3>
              <ul className="plain-list" aria-labelledby={`agenda-${date}`}>
                {(byDay.get(date) ?? []).map(row)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
