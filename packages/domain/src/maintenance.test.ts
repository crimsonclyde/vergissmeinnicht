import { describe, expect, it } from 'vitest';
import { DomainValidationError } from './errors.ts';
import {
  CURRENCY_CODES,
  MAINTENANCE_STATUSES,
  maintenanceSearchText,
  maintenanceSortDate,
  normalizeCost,
  normalizeMaintenanceContent,
  parseMaintenanceCursor,
  parseMaintenanceLinkTarget,
  parseMaintenanceQuery,
  parseMaintenanceStatus,
  statusChange,
} from './maintenance.ts';

const codeOf = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof DomainValidationError ? error.code : String(error);
  }
  return undefined;
};
const ID = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';

describe('Maintenance (16.7)', () => {
  it('has exactly four statuses, in the order of the board', () => {
    expect(MAINTENANCE_STATUSES).toEqual(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
    expect(parseMaintenanceStatus('IN_PROGRESS')).toBe('IN_PROGRESS');
    for (const status of ['DONE', 'planned', '', 'ON_HOLD']) expect({ status, code: codeOf(() => parseMaintenanceStatus(status)) }).toEqual({ status, code: 'invalid_maintenance_status' });
  });

  it('allows every change between the four statuses, and ties the completion date to Completed', () => {
    for (const from of MAINTENANCE_STATUSES) {
      for (const to of MAINTENANCE_STATUSES) {
        const change = statusChange(from, to, null, '2026-10-02');
        if (from === to) expect(change).toBeUndefined();
        else expect(change).toEqual({ status: to, completedOn: to === 'COMPLETED' ? '2026-10-02' : null });
      }
    }
    // The day the work was done can be said; it is dropped again when the record is reopened.
    expect(statusChange('IN_PROGRESS', 'COMPLETED', '2026-09-28', '2026-10-02')).toEqual({ status: 'COMPLETED', completedOn: '2026-09-28' });
    expect(statusChange('COMPLETED', 'IN_PROGRESS', '2026-09-28', '2026-10-02')).toEqual({ status: 'IN_PROGRESS', completedOn: null });
    // Cancelled is never Completed: it carries no completion date, whatever is sent along.
    expect(statusChange('PLANNED', 'CANCELLED', '2026-09-28', '2026-10-02')).toEqual({ status: 'CANCELLED', completedOn: null });
  });

  it('needs only a title', () => {
    expect(normalizeMaintenanceContent({ title: '  Boiler service ' })).toEqual({ title: 'Boiler service', category: '', date: null, description: '', contactId: null, cost: null });
    expect(normalizeMaintenanceContent({ title: 'Boiler service', category: ' Heating ', date: '2026-11-03', description: 'Yearly\r\ncheck', contactId: ID, cost: { amount: '120,5', currency: 'eur' } })).toEqual({
      title: 'Boiler service',
      category: 'Heating',
      date: '2026-11-03',
      description: 'Yearly\ncheck',
      contactId: ID,
      cost: { amount: '120.5', currency: 'EUR' },
    });
    expect(codeOf(() => normalizeMaintenanceContent({ title: ' ' }))).toBe('maintenance_title_empty');
    expect(codeOf(() => normalizeMaintenanceContent({ title: 'x'.repeat(201) }))).toBe('maintenance_title_too_long');
    expect(codeOf(() => normalizeMaintenanceContent({ title: 'a\u202Eb' }))).toBe('maintenance_title_invalid_characters');
    expect(codeOf(() => normalizeMaintenanceContent({ title: 'x', category: 'y'.repeat(61) }))).toBe('maintenance_category_too_long');
    expect(codeOf(() => normalizeMaintenanceContent({ title: 'x', description: 'y'.repeat(4001) }))).toBe('maintenance_description_too_long');
    expect(codeOf(() => normalizeMaintenanceContent({ title: 'x', description: 'bell\u0007' }))).toBe('maintenance_description_invalid_characters');
    expect(codeOf(() => normalizeMaintenanceContent({ title: 'x', date: '2026-02-30' }))).toBe('invalid_document_date');
    expect(codeOf(() => normalizeMaintenanceContent({ title: 'x', contactId: 'not-an-id' }))).toBe('invalid_contact_id');
  });

  it('records a cost as written — decimal text and a currency — and calculates nothing', () => {
    expect(normalizeCost(null)).toBeNull();
    expect(normalizeCost({ amount: ' ', currency: '' })).toBeNull();
    expect(normalizeCost({ amount: '120.00', currency: 'EUR' })).toEqual({ amount: '120.00', currency: 'EUR' });
    expect(normalizeCost({ amount: '0120.10', currency: 'chf' })).toEqual({ amount: '120.10', currency: 'CHF' });
    expect(normalizeCost({ amount: '0,5', currency: 'EUR' })).toEqual({ amount: '0.5', currency: 'EUR' });
    expect(normalizeCost({ amount: '1500', currency: 'JPY' })).toEqual({ amount: '1500', currency: 'JPY' });
    // A value a float would change stays what was typed.
    expect(normalizeCost({ amount: '0.1', currency: 'EUR' })?.amount).toBe('0.1');
    expect(normalizeCost({ amount: '999999999999.999', currency: 'KWD' })?.amount).toBe('999999999999.999');
    for (const amount of ['-5', '+5', '1e3', '1,000.00', '1.000,00', '12.3456', 'abc', '1 200', '.5', '5.', '0x10', '=1+1', '1234567890123', '']) {
      expect({ amount, code: codeOf(() => normalizeCost({ amount, currency: 'EUR' })) }).toEqual({ amount, code: 'invalid_cost_amount' });
    }
    for (const currency of ['', 'EURO', '€', 'XXX', 'E U', 'BTC']) expect({ currency, code: codeOf(() => normalizeCost({ amount: '5', currency })) }).toEqual({ currency, code: 'invalid_cost_currency' });
    expect(CURRENCY_CODES).toEqual([...new Set(CURRENCY_CODES)]);
    for (const code of CURRENCY_CODES) expect(code).toMatch(/^[A-Z]{3}$/);
    for (const code of ['EUR', 'USD', 'CHF', 'GBP']) expect(CURRENCY_CODES).toContain(code);
  });

  it('files a record under its completion day, else its date, else the day it was created', () => {
    expect(maintenanceSortDate({ completedOn: '2026-10-02', date: '2026-09-01', createdOn: '2026-08-01' })).toBe('2026-10-02');
    expect(maintenanceSortDate({ completedOn: null, date: '2026-09-01', createdOn: '2026-08-01' })).toBe('2026-09-01');
    expect(maintenanceSortDate({ completedOn: null, date: null, createdOn: '2026-08-01' })).toBe('2026-08-01');
  });

  it('parses what the List can be asked for', () => {
    expect(parseMaintenanceQuery({})).toEqual({ terms: [], status: null, category: null, contactId: null, equipmentId:null, year: null });
    expect(parseMaintenanceQuery({ q: ' BOILER  Müll ', status: 'COMPLETED', category: ' Heizung ', contact: ID, year: 2026 })).toEqual({ terms: ['boiler', 'mull'], status: 'COMPLETED', category: 'heizung', contactId: ID, equipmentId:null, year: 2026 });
    expect(codeOf(() => parseMaintenanceQuery({ status: 'DONE' }))).toBe('invalid_maintenance_status');
    expect(codeOf(() => parseMaintenanceQuery({ contact: 'x' }))).toBe('invalid_contact_id');
    expect(codeOf(() => parseMaintenanceQuery({ year: 1800 }))).toBe('invalid_document_year');
    expect(maintenanceSearchText({ title: 'Boiler Service', category: 'Heizung', description: 'Jährlich' })).toBe('boiler service\nheizung\njahrlich');
    expect(parseMaintenanceCursor(['2026-10-02', ID])).toEqual({ value: '2026-10-02', id: ID });
    for (const bad of [null, [], ['2026-10-02'], ['today', ID], ['2026-10-02', 'x'], [20261002, ID], { value: '2026-10-02', id: ID }]) expect(parseMaintenanceCursor(bad)).toBeUndefined();
  });

  it('links a record to Documents, Procedures, Runs and Schedules only', () => {
    for (const type of ['document', 'procedure', 'run', 'schedule']) expect(parseMaintenanceLinkTarget({ type, id: ID })).toEqual({ type, id: ID });
    for (const type of ['contact', 'maintenance', 'occurrence', 'user', '']) expect({ type, code: codeOf(() => parseMaintenanceLinkTarget({ type, id: ID })) }).toEqual({ type, code: 'invalid_link_target' });
    expect(codeOf(() => parseMaintenanceLinkTarget({ type: 'run', id: 'x' }))).toBe('invalid_link_target');
  });
});
