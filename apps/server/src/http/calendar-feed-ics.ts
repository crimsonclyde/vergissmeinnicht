import type { CalendarFeedContent } from '@vergissmeinnicht/application';
import { addDays, zonedInstant, type LocalDate, type LocalTime, type Schedule } from '@vergissmeinnicht/domain';

/** Length of a timed entry in calendar apps; VMN entries are points in time, not appointments. */
const TIMED_ENTRY_MINUTES = 30;

/** RFC 5545 TEXT: backslash, semicolon, comma and line breaks escaped; other control characters removed. */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/** Folds a content line at 75 octets without splitting a UTF-8 character (RFC 5545 3.1). */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with one space
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

const basicDate = (date: LocalDate) => date.replaceAll('-', '');
const utcStamp = (instant: Date) => `${instant.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;

function timing(date: LocalDate, time: LocalTime | null, schedule: Schedule): string[] {
  if (time === null) return [`DTSTART;VALUE=DATE:${basicDate(date)}`, `DTEND;VALUE=DATE:${basicDate(addDays(date, 1))}`];
  const start = zonedInstant(date, time, schedule.timeZone);
  return [`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(new Date(start.getTime() + TIMED_ENTRY_MINUTES * 60_000))}`];
}

function details(schedule: Schedule, assignee: { readonly displayName: string } | null, planned: boolean): string {
  const kind = schedule.kind === 'PROCEDURE' ? 'Procedure' : 'Reminder';
  const who = assignee === null ? 'Shared' : `Assigned to ${assignee.displayName}`;
  return [kind, who, ...(planned ? ['Planned (repeats)'] : [])].join(' · ');
}

/**
 * The iCalendar document of a calendar subscription (39). Only what the calendar page shows at a glance: title,
 * date and time, kind, who is responsible and whether it is done. Never Reminder descriptions, notes, Steps,
 * email addresses or ids of people. Completed entries keep their date and get a check mark.
 */
export function renderCalendarFeed(content: CalendarFeedContent, options: { readonly publicOrigin: string; readonly now: Date }): string {
  const host = new URL(options.publicOrigin).hostname;
  const calendarUrl = `${options.publicOrigin}/w/${content.workspaceId}/calendar`;
  const stamp = utcStamp(options.now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//VergissMeinNicht//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(`VMN · ${content.workspaceName}`)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  const event = (uid: string, summary: string, when: string[], description: string, status: 'CONFIRMED' | 'TENTATIVE') =>
    lines.push('BEGIN:VEVENT', `UID:${uid}@${host}`, `DTSTAMP:${stamp}`, ...when, `SUMMARY:${escapeText(summary)}`, `DESCRIPTION:${escapeText(description)}`, `URL:${calendarUrl}`, `STATUS:${status}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
  for (const { schedule, occurrence } of content.occurrences) {
    const done = occurrence.state === 'COMPLETED';
    event(`occurrence-${occurrence.id}`, `${done ? '✓ ' : ''}${schedule.title}`, timing(occurrence.dueDate, occurrence.time, schedule), details(schedule, occurrence.assignee ?? schedule.assignee, false), 'CONFIRMED');
  }
  for (const { schedule, dueDate, time } of content.projected) {
    event(`planned-${schedule.id}-${dueDate}`, schedule.title, timing(dueDate, time, schedule), details(schedule, schedule.assignee, true), 'TENTATIVE');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
