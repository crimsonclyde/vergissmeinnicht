import { describe, expect, it } from 'vitest';
import { t } from '../i18n/index.ts';
import { navigation } from '../navigation.ts';

const W = '3f1c2b9a-6d4e-4f8a-9b7c-1a2b3c4d5e6f';
const ALL = ['PROCEDURES', 'REMINDERS', 'LISTS', 'CALENDAR', 'RECIPES', 'BRING', 'JOURNAL', 'DOCUMENTS', 'CONTACTS', 'MAINTENANCE', 'EQUIPMENT'];
const labels = (items: readonly { label: string }[]) => items.map(item => item.label);

describe('navigation families (42)', () => {
  it('sorts every enabled tool into Plan, Shop & cook and House (default order), then the instruments', () => {
    const nav = navigation(W, ALL);
    expect(nav.groups.map(group => group.id)).toEqual(['plan', 'shop', 'house', 'instruments']);
    expect(labels(nav.groups[0]?.items ?? [])).toEqual(['Procedures', 'Reminders', 'Calendar', t('shell.history')]);
    expect(labels(nav.groups[1]?.items ?? [])).toEqual(['Lists', t('bring.heading'), t('recipes.heading')]);
    expect(labels(nav.groups[2]?.items ?? [])).toEqual([t('journal.heading'), 'Documents', 'Contacts', 'Maintenance']);
    expect(labels(nav.groups[3]?.items ?? [])).toEqual([t('weather.heading'), t('navigation.clock')]);
    // Every tool exactly once across the families.
    const hrefs = nav.groups.flatMap(group => group.items.map(item => item.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it('never offers a tool that is switched off, and drops a family with nothing in it', () => {
    const nav = navigation(W, ['LISTS']);
    expect(nav.groups.map(group => group.id)).toEqual(['shop', 'instruments']);
    expect(labels(nav.tools)).toEqual(['Lists']);
    expect(navigation(W, []).groups.map(group => group.id)).toEqual(['instruments']);
    expect(navigation(W, ['UNKNOWN']).tools).toHaveLength(0);
    // History looks back on Procedures: without them it is not offered.
    expect(navigation(W, ['REMINDERS']).groups[0]?.items.some(item => item.pages.includes('history'))).toBe(false);
  });

  it('keeps the person’s order inside each family and puts their first two tools on the phone bar', () => {
    const nav = navigation(W, ALL, ['DOCUMENTS', 'BRING', 'CONTACTS', 'LISTS']);
    expect(labels(nav.bar)).toEqual([t('shell.today'), 'Documents', t('bring.heading')]);
    expect(labels(nav.groups.find(group => group.id === 'house')?.items ?? []).slice(0, 2)).toEqual(['Documents', 'Contacts']);
    expect(labels(nav.groups.find(group => group.id === 'shop')?.items ?? [])).toEqual([t('bring.heading'), 'Lists', t('recipes.heading')]);
    expect(labels(navigation(W, ALL).bar)).toEqual([t('shell.today'), 'Procedures', 'Lists']);
    expect(labels(navigation(W, ['LISTS'], ['DOCUMENTS', 'LISTS']).bar)).toEqual([t('shell.today'), 'Lists']);
  });

  it('marks exactly one destination for every tool page and none for settings', () => {
    const nav = navigation(W, ALL);
    const every = [nav.today, ...nav.groups.flatMap(group => group.items)];
    for (const page of ['workspace', 'procedures', 'procedure-edit', 'photos', 'reminders', 'lists', 'calendar', 'history', 'recipes', 'bring', 'journal', 'documents', 'contacts', 'maintenance', 'equipment', 'weather', 'clock'] as const) {
      expect({ page, current: every.filter(item => item.pages.includes(page)).length }).toEqual({ page, current: 1 });
    }
    for (const page of ['settings', 'members', 'knots', 'account', 'admin', 'more'] as const) {
      expect(every.some(item => item.pages.includes(page))).toBe(false);
    }
  });

  it('shows Equipment and Maintenance as one Maintenance area, opening the tab used last (41.2)', () => {
    const area = (tools: readonly string[]) => navigation(W, tools).groups.find(group => group.id === 'house')?.items ?? [];
    expect(area(['EQUIPMENT', 'MAINTENANCE'])).toEqual([expect.objectContaining({ label: 'Maintenance', href: `/w/${W}/maintenance`, pages: ['maintenance', 'equipment'] })]);
    expect(area(['EQUIPMENT'])[0]?.href).toBe(`/w/${W}/equipment`);
    expect(area(['MAINTENANCE'])[0]?.href).toBe(`/w/${W}/maintenance`);
    // Both first in the person's order: still one favourite on the phone bar.
    expect(labels(navigation(W, ['EQUIPMENT', 'MAINTENANCE', 'LISTS'], ['EQUIPMENT', 'MAINTENANCE', 'LISTS']).bar)).toEqual([t('shell.today'), 'Maintenance', 'Lists']);
  });

  it('links each destination inside the Workspace', () => {
    const nav = navigation(W, ALL);
    for (const item of nav.groups.filter(group => group.id !== 'instruments').flatMap(group => group.items)) expect(item.href.startsWith(`/w/${W}/`)).toBe(true);
    expect(nav.today.href).toBe(`/w/${W}`);
  });
});
