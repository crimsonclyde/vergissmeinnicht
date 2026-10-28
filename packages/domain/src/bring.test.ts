import { describe, expect, it } from 'vitest';
import { bringRelevant, parseBringContent } from './bring.ts';
const content = { title: '  Drill  ', from: ' Munich ', to: 'Triora', notes: 'spare\nbattery', assigneeId: null, dueDate: '2028-02-29' };
describe('Bring content and civil date relevance', () => {
 it('normalizes bounded plain text and rejects impossible dates and unknown fields', () => {
  expect(parseBringContent(content)).toMatchObject({ title: 'Drill', from: 'Munich', notes: 'spare\nbattery' });
  for (const change of [{ dueDate: '2027-02-29' }, { dueDate: '2028-02-30' }, { from: 'a\nb' }, { notes: 'a\u202eb' }, { title: '<script>literal</script>', extra: true }]) expect(() => parseBringContent({ ...content, ...change })).toThrow();
  expect(parseBringContent({ ...content, title: '<script>literal</script>' }).title).toBe('<script>literal</script>');
 });
 it('includes overdue, today and seven days ahead across DST, and undated items assigned only to the viewer', () => {
  const item = { status: 'OPEN' as const, dueDate: '2026-10-25', assigneeId: null };
  expect(bringRelevant(item, '2026-10-24', 'me')).toBe(true);
  expect(bringRelevant({ ...item, dueDate: '2026-10-31' }, '2026-10-24', 'me')).toBe(true);
  expect(bringRelevant({ ...item, dueDate: '2026-11-01' }, '2026-10-24', 'me')).toBe(false);
  expect(bringRelevant({ ...item, dueDate: '2020-01-01' }, '2026-10-24', 'me')).toBe(true);
  for (const assigneeId of [null, 'someone', 'me']) expect(bringRelevant({ ...item, dueDate: null, assigneeId }, '2026-10-24', 'me')).toBe(assigneeId === 'me');
  for (const status of ['COMPLETED', 'CANCELLED'] as const) expect(bringRelevant({ ...item, status }, '2026-10-24', 'me')).toBe(false);
 });
});
