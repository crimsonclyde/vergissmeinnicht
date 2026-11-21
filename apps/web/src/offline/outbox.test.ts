import { describe, expect, it } from 'vitest';
import { ApiError, type JournalView } from '../api.ts';
import { noteView, outboxOutcome, outboxRefusal, sameNote, waitingOutboxIds, withChange, withQueuedNotes, type OutboxChange, type QueuedOutboxChange } from './outbox.ts';

const W = 'aaaaaaaa-0000-4000-8000-000000000001';
const content = (title: string, body = 'text') => ({ kind: 'note' as const, version: 2 as const, title, date: null, body, collection: '', tags: [], pinned: false });
const saved: JournalView = { id: 'n1', ...content('Boiler', 'old'), revision: 4, archived: false, createdAt: '2026-11-01T08:00:00.000Z', updatedAt: '2026-11-01T08:00:00.000Z', createdBy: 'Ada', updatedBy: 'Ada' };
let seq = 0;
const queued = (change: OutboxChange, extra: Partial<QueuedOutboxChange> = {}): QueuedOutboxChange => ({ clientChangeId: `c${++seq}`, userId: 'u', change, label: 'x', deviceTime: '2026-11-21T09:00:00.000Z', seq, ...extra });
const note = (entryId: string, title: string, extra: Partial<Extract<OutboxChange, { kind: 'note' }>> = {}): OutboxChange => ({ kind: 'note', workspaceId: W, entryId, isNew: false, expectedRevision: 4, content: content(title), archived: false, ...extra });

describe('Notes and Reminders kept on this device (48.5)', () => {
  it('a Note changed twice offline keeps one entry: the newest text, the first revision, its place in the order', () => {
    const first = queued(note('n1', 'Boiler v1'));
    const next = withChange([first], queued(note('n1', 'Boiler v2', { expectedRevision: 9 })));
    expect(next.clientChangeId).toBe(first.clientChangeId);
    expect(next.seq).toBe(first.seq);
    expect(next.change).toMatchObject({ expectedRevision: 4, content: { title: 'Boiler v2' } });
    // A new Note stays new until it was sent.
    const created = queued(note('n2', 'Garden', { isNew: true, expectedRevision: 0 }));
    expect(withChange([created], queued(note('n2', 'Garden plan', { expectedRevision: 0 }))).change).toMatchObject({ isNew: true, content: { title: 'Garden plan' } });
    // Refused changes are not merged into.
    const refused = queued(note('n3', 'Van'), { refused: 'forbidden' });
    expect(withChange([refused], queued(note('n3', 'Van 2'))).clientChangeId).not.toBe(refused.clientChangeId);
  });

  it('shows saved Notes with this device’s changes, new ones first, only in their own place', () => {
    const changes = [queued(note('n1', 'Boiler (edited)')), queued(note('n9', 'New note', { isNew: true, expectedRevision: 0 })), queued(note('n8', 'Other place', { isNew: true, workspaceId: null }))];
    const shown = withQueuedNotes([saved], changes, W, false, 'you');
    expect(shown.map((entry) => entry.title)).toEqual(['New note', 'Boiler (edited)']);
    expect(shown[1]).toMatchObject({ id: 'n1', revision: 4, updatedBy: 'you', createdBy: 'Ada' });
    expect(withQueuedNotes([], changes, null, false, 'you').map((entry) => entry.title)).toEqual(['Other place']);
    // Archived offline: it leaves the open list and appears among the archived ones.
    const archived = [queued(note('n1', 'Boiler', { archived: true }))];
    expect(withQueuedNotes([saved], archived, W, false, 'you')).toEqual([]);
    expect(withQueuedNotes([saved], archived, W, true, 'you').map((entry) => entry.id)).toEqual(['n1']);
    expect(waitingOutboxIds(changes)).toEqual(new Set(['n1', 'n9', 'n8']));
  });

  it('decides per answer: keep, explain, refuse or retry — never force', () => {
    expect(outboxOutcome(undefined)).toBe('sent');
    expect(outboxOutcome(new TypeError('Failed to fetch'))).toBe('retry');
    expect(outboxOutcome(new ApiError(503, 'unavailable'))).toBe('retry');
    expect(outboxOutcome(new ApiError(429, 'rate_limited'))).toBe('retry');
    expect(outboxOutcome(new ApiError(401, 'unauthenticated'))).toBe('sign-in');
    expect(outboxOutcome(new ApiError(409, 'journal_conflict'))).toBe('conflict');
    expect(outboxOutcome(new ApiError(404, 'journal_not_found'))).toBe('conflict');
    expect(outboxOutcome(new ApiError(409, 'schedule_closed'))).toBe('conflict');
    expect(outboxOutcome(new ApiError(404, 'tool_not_enabled'))).toBe('refused');
    expect(outboxRefusal(new ApiError(404, 'tool_not_enabled'))).toBe('tool_disabled');
    expect(outboxRefusal(new ApiError(404, 'workspace_not_found'))).toBe('not_member');
    expect(outboxRefusal(new ApiError(403, 'journal_consent_required'))).toBe('forbidden');
    expect(outboxOutcome(new ApiError(400, 'invalid_journal_entry'))).toBe('drop');
  });

  it('recognises its own Note after a lost answer, and nothing else', () => {
    const change = note('n1', 'Boiler', { content: { ...content('Boiler'), body: 'old' } }) as Extract<OutboxChange, { kind: 'note' }>;
    expect(sameNote(saved, change)).toBe(true);
    expect(sameNote({ ...saved, body: 'someone else' }, change)).toBe(false);
    expect(sameNote({ ...saved, archived: true }, change)).toBe(false);
    expect(noteView(change, null, '2026-11-21T09:00:00.000Z', 'you')).toMatchObject({ id: 'n1', title: 'Boiler', createdBy: 'you', revision: 4 });
  });
});
