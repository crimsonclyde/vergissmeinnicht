import { DomainValidationError } from './errors.ts';
import { BIDI_CONTROLS, CONTROL_CHARS } from './text.ts';
import { UUID_V4 } from './user.ts';
export const BRING_STATUSES = ['OPEN', 'COMPLETED', 'CANCELLED'] as const;
export type BringStatus = typeof BRING_STATUSES[number];
export interface BringContent { title: string; from: string; to: string; dueDate: string | null; assigneeId: string | null; notes: string }
export interface BringItem extends BringContent { id: string; assigneeName: string | null; status: BringStatus; revision: number; completedAt: Date | null; completedBy: string | null; cancelledAt: Date | null; cancelledBy: string | null; createdAt: Date; createdBy: string; updatedAt: Date; updatedBy: string; deleted: boolean }
export function parseBringContent(value: unknown): BringContent {
  const fail = (): never => { throw new DomainValidationError('bring', 'invalid_bring', 'Invalid Bring item'); };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  const keys = ['title', 'from', 'to', 'dueDate', 'assigneeId', 'notes'];
  if (Object.keys(row).length !== keys.length || Object.keys(row).some(key => !keys.includes(key))) return fail();
  const text = (key: string, max: number, multiline = false) => {
    const raw = row[key];
    if (typeof raw !== 'string') return fail();
    const normalized = raw.normalize('NFC').trim();
    if (Array.from(normalized).length > max || BIDI_CONTROLS.test(normalized) || CONTROL_CHARS.test(multiline ? normalized.replace(/[\n\r\t]/g, '') : normalized) || (!multiline && /[\n\r]/.test(normalized))) return fail();
    return normalized;
  };
  const title = text('title', 120);
  if (!title) return fail();
  const date = row['dueDate'];
  if (date !== null && (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) return fail();
  const assignee = row['assigneeId'];
  if (assignee !== null && (typeof assignee !== 'string' || !UUID_V4.test(assignee))) return fail();
  return { title, from: text('from', 80), to: text('to', 80), dueDate: date as string | null, assigneeId: assignee as string | null, notes: text('notes', 2000, true) };
}
/** Civil-date arithmetic, independent of DST and the device's UTC offset. */
export function bringRelevant(item: Pick<BringItem, 'status' | 'dueDate' | 'assigneeId'>, today: string, userId: string): boolean {
  const end = new Date(today + 'T12:00:00Z'); end.setUTCDate(end.getUTCDate() + 7);
  return item.status === 'OPEN' && (item.dueDate === null ? item.assigneeId === userId : item.dueDate <= end.toISOString().slice(0, 10));
}
