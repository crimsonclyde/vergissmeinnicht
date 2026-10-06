import { describe, expect, it } from 'vitest';
import { datesIn, suggestFromText, suggestionKey } from './document-suggestions.ts';
import { PAGE_SEPARATOR } from './document-text.ts';
import { foldSearchText } from './document-search.ts';

const byField = (text: string) => Object.fromEntries(suggestFromText(text).map((each) => [each.field, each]));

describe('rule-based suggestions (16.9 task 5)', () => {
  it('reads an Italian water bill: type, supplier, title, due date, document date, amount — each with its source', () => {
    const found = byField(
      [
        'ACQUEDOTTO PUGLIESE S.p.A.',
        'Bolletta acqua n. 2026/004512 del 12/07/2026',
        'Periodo di fatturazione: 01/04/2026 - 30/06/2026',
        'Totale da pagare: EUR 87,40',
        'Scadenza pagamento: 15/08/2026',
      ].join('\n'),
    );
    expect(found.type).toMatchObject({ value: 'bill', page: 1, excerpt: 'Bolletta acqua n. 2026/004512 del 12/07/2026' });
    expect(found.supplier?.value).toBe('ACQUEDOTTO PUGLIESE S.p.A.');
    expect(found.title?.value).toBe('Bolletta ACQUEDOTTO PUGLIESE S.p.A.');
    expect(found.dueDate).toMatchObject({ value: '2026-08-15', excerpt: 'Scadenza pagamento: 15/08/2026' });
    expect(found.documentDate?.value).toBe('2026-07-12');
    expect(found.amount).toMatchObject({ value: '87.40 EUR', excerpt: 'Totale da pagare: EUR 87,40' });
  });

  it('reads a German insurance notice with month names and a due date on the next line', () => {
    const found = byField(['Allianz Versicherungs-AG', 'Rechnung', 'Datum: 1. Oktober 2026', 'Jahresbeitrag 1.184,20 €', 'Fälligkeit:', '01.11.2026'].join('\n'));
    expect(found.type?.value).toBe('bill');
    expect(found.supplier?.value).toBe('Allianz Versicherungs-AG');
    expect(found.title?.value).toBe('Rechnung Allianz Versicherungs-AG');
    expect(found.documentDate?.value).toBe('2026-10-01');
    expect(found.dueDate).toMatchObject({ value: '2026-11-01', excerpt: '01.11.2026' });
    expect(found.amount?.value).toBe('1184.20 EUR');
  });

  it('reads an English receipt, and the page where a value was found', () => {
    const found = byField(['NORTHWIND HARDWARE LTD', 'Receipt 000318 - 12 Sep 2026'].join('\n') + PAGE_SEPARATOR + 'TOTAL GBP 163.78');
    expect(found.type?.value).toBe('receipt');
    expect(found.title?.value).toBe('Receipt NORTHWIND HARDWARE LTD');
    expect(found.amount).toMatchObject({ value: '163.78 GBP', page: 2 });
  });

  it('reads a French invoice: type, company form, month names, apostrophes, total TTC', () => {
    const found = byField(['EDF ENERGIE SAS', 'Facture n° 2026-1144', 'Date de facture : 3 septembre 2026', 'Montant TTC : 64,90 €', 'Date d’échéance : 18/09/2026'].join('\n'));
    expect(found.type?.value).toBe('bill');
    expect(found.supplier?.value).toBe('EDF ENERGIE SAS');
    expect(found.title?.value).toBe('Facture EDF ENERGIE SAS');
    expect(found.documentDate?.value).toBe('2026-09-03');
    expect(found.dueDate?.value).toBe('2026-09-18');
    expect(found.amount?.value).toBe('64.90 EUR');
    expect(byField('IKEA SARL\nTicket de caisse\nTotal TTC 104,50 EUR').type?.value).toBe('receipt');
  });

  it('suggests nothing from text that does not clearly say it', () => {
    expect(suggestFromText('')).toEqual([]);
    expect(suggestFromText('Ciao Maria, ci vediamo il 12/07/2026 alle 18.\nA presto')).toEqual([]);
    // A date that does not exist, a number without currency, a year far away.
    expect(byField('Scadenza 31/02/2026\nTotale 87,40\nDatum 01.01.1850')).toEqual({});
  });

  it('finds dates in the usual spellings, day before month for numbers', () => {
    expect(datesIn(foldSearchText('15/08/2026 15.08.26 2026-08-15 15 agosto 2026 1. März 2026 September 12, 2026 32/01/2026'))).toEqual([
      '2026-08-15',
      '2026-08-15',
      '2026-08-15',
      '2026-08-15',
      '2026-03-01',
      '2026-09-12',
    ]);
  });

  it('remembers a dismissal by field and folded value', () => {
    expect(suggestionKey('supplier', 'Allianz Versicherungs-AG')).toBe(suggestionKey('supplier', 'ALLIANZ VERSICHERUNGS-AG'));
    expect(suggestionKey('supplier', 'x')).not.toBe(suggestionKey('title', 'x'));
  });

  it('keeps hostile text as plain values: nothing is interpreted', () => {
    const found = byField('<script>alert(1)</script> GmbH\nRechnung\n=HYPERLINK("x") Total EUR 5,00');
    expect(found.supplier?.value).toBe('<script>alert(1)</script> GmbH');
    expect(found.amount?.value).toBe('5.00 EUR');
  });
});
