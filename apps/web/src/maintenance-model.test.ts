import { describe, expect, it } from 'vitest';
import type { MaintenanceColumn, MaintenanceSummary } from './api.ts';
import { formatCalendarDate } from './i18n/index.ts';
import { STATUSES, STATUS_GLYPHS, cardContext, costText, dateText, emptyMaintenanceForm, findCard, inputOfForm, isMove, localToday, maintenanceListingParams, statusLabel } from './maintenance-model.ts';

const record = (over: Partial<MaintenanceSummary> = {}): MaintenanceSummary => ({ id: 'a', title: 'Boiler service', category: '', date: null, status: 'PLANNED', completedOn: null, contact: null, cost: null, revision: 1, ...over });

describe('Maintenance in the browser (16.7)', () => {
  it('names every status with a word and a glyph of its own', () => {
    expect(STATUSES.map(statusLabel)).toEqual(['Planned', 'In progress', 'Completed', 'Cancelled']);
    expect(new Set(STATUSES.map((status) => STATUS_GLYPHS[status])).size).toBe(4);
  });

  it('says which date it shows, and never makes Cancelled look Completed', () => {
    expect(dateText(record({ date: '2026-11-03' }))).toBe(`Planned for ${formatCalendarDate('2026-11-03')}`);
    expect(dateText(record({ status: 'COMPLETED', completedOn: '2026-11-05', date: '2026-11-03' }))).toBe(`Completed on ${formatCalendarDate('2026-11-05')}`);
    expect(dateText(record({ status: 'CANCELLED', date: '2026-11-03' }))).toBe(`Was planned for ${formatCalendarDate('2026-11-03')}`);
    expect(dateText(record())).toBeNull();
    expect(cardContext(record({ category: 'Heating', date: '2026-11-03', contact: { id: 'c', name: 'Idraulico Rossi' } }))).toBe(`Heating · Planned for ${formatCalendarDate('2026-11-03')} · Idraulico Rossi`);
    expect(cardContext(record({ contact: { id: 'c', name: null } }))).toBe('A deleted contact');
    expect(cardContext(record())).toBe('');
  });

  it('shows a cost exactly as recorded and sends none without an amount', () => {
    expect(costText({ amount: '120.00', currency: 'EUR' })).toBe('120.00 EUR');
    expect(costText({ amount: '0.1', currency: 'CHF' })).toBe('0.1 CHF');
    expect(inputOfForm({ ...emptyMaintenanceForm('Boiler service'), amount: ' 120.00 ', date: '2026-11-03' })).toEqual({ title: 'Boiler service', category: '', date: '2026-11-03', description: '', contactId: null, cost: { amount: '120.00', currency: 'EUR' } });
    expect(inputOfForm(emptyMaintenanceForm('x'))).toMatchObject({ date: null, contactId: null, cost: null });
  });

  it('builds a listing address and today in local time', () => {
    expect(maintenanceListingParams({ q: ' boiler ', status: 'COMPLETED', category: 'Heating', contact: '', year: '2026' }, 'abc')).toBe('q=boiler&status=COMPLETED&category=Heating&year=2026&cursor=abc');
    expect(maintenanceListingParams({ q: '', status: '', category: '', contact: '', year: '' })).toBe('');
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });

  it('treats a drop on the card’s own column as nothing to do', () => {
    const columns: MaintenanceColumn[] = [
      { status: 'PLANNED', total: 1, records: [record()] },
      { status: 'IN_PROGRESS', total: 1, records: [record({ id: 'b', status: 'IN_PROGRESS' })] },
    ];
    expect(findCard(columns, 'b')?.status).toBe('IN_PROGRESS');
    expect(findCard(columns, 'zzz')).toBeUndefined();
    expect(isMove(findCard(columns, 'a'), 'IN_PROGRESS')).toBe(true);
    expect(isMove(findCard(columns, 'a'), 'PLANNED')).toBe(false);
    expect(isMove(findCard(columns, 'zzz'), 'PLANNED')).toBe(false);
  });
});
