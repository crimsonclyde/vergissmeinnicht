import type { BuiltInDocumentType } from './document.ts';
import { PAGE_SEPARATOR } from './document-text.ts';
import { foldSearchText } from './document-search.ts';

/**
 * Rule-based suggestions from recognised text (steps.md 16.9 task 5). Deterministic patterns for
 * Italian, German and English household documents — no model, no network. A suggestion is only ever
 * **shown**: it names its source ("from the text on page 1") and is accepted or dismissed one by one
 * by a person; it never changes a field, creates a Reminder or a Contact by itself. Because the rules
 * are pure functions of the stored text, suggestions are computed when asked for and never stored —
 * reprocessing cannot overwrite anything a person decided.
 */
export const SUGGESTION_FIELDS = ['title', 'type', 'documentDate', 'dueDate', 'amount', 'supplier'] as const;
export type SuggestionField = (typeof SUGGESTION_FIELDS)[number];

export interface DocumentSuggestion {
  readonly field: SuggestionField;
  /** Machine value: an ISO date, a type key, an amount like `87.40 EUR`, or text. */
  readonly value: string;
  /** 1-based page of the file the value was read from. */
  readonly page: number;
  /** The line it was read from, as printed (plain text, at most 160 characters). */
  readonly excerpt: string;
}

const MAX_EXCERPT = 160;

const MONTHS: Readonly<Record<string, number>> = {
  // English
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
  // German (folded: März → marz)
  januar: 1, februar: 2, marz: 3, mai: 5, juni: 6, juli: 7, oktober: 10, okt: 10, dezember: 12, dez: 12,
  // Italian
  gennaio: 1, gen: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, mag: 5, giugno: 6, giu: 6, luglio: 7, lug: 7, agosto: 8, ago: 8, settembre: 9, set: 9, ottobre: 10, ott: 10, novembre: 11, dicembre: 12, dic: 12,
};

/** Words before a payment due date. Folded (no accents, lower case, ß → ss). */
const DUE_WORDS = ['scadenza', 'scade il', 'da pagare entro', 'entro il', 'pagare entro', 'faelligkeit', 'falligkeit', 'fallig am', 'fallig', 'zahlbar bis', 'zahlungsziel', 'bitte zahlen sie bis', 'due date', 'payment due', 'pay by', 'due by', 'due on'];
/** Words before the date of the document itself. */
const DATE_WORDS = ['data emissione', 'data fattura', 'data documento', 'del', 'rechnungsdatum', 'datum', 'ausstellungsdatum', 'invoice date', 'date of issue', 'issue date', 'date'];
/** Words before the amount to pay. Longer phrases first: the first one found on a line wins. */
const AMOUNT_WORDS = ['totale da pagare', 'importo da pagare', 'totale fattura', 'importo totale', 'totale', 'importo', 'gesamtbetrag', 'rechnungsbetrag', 'zu zahlender betrag', 'zahlbetrag', 'endbetrag', 'jahresbeitrag', 'betrag', 'amount due', 'balance due', 'total due', 'grand total', 'total'];
/** Types by words that name them — the word as printed becomes part of a suggested title. */
const TYPE_WORDS: readonly (readonly [BuiltInDocumentType, readonly string[]])[] = [
  ['receipt', ['ricevuta', 'scontrino', 'quittung', 'kassenbon', 'kassenbeleg', 'receipt']],
  ['tax_notice', ['avviso di pagamento imu', 'cartella esattoriale', 'steuerbescheid', 'tax notice', 'tax bill']],
  ['warranty', ['garanzia', 'garantieschein', 'garantie', 'warranty']],
  ['inspection_report', ['verbale di ispezione', 'prufbericht', 'prufprotokoll', 'inspection report']],
  ['contract', ['contratto', 'vertrag', 'contract', 'agreement']],
  ['manual', ['manuale', 'istruzioni per l', 'bedienungsanleitung', 'gebrauchsanweisung', 'user manual', 'instruction manual']],
  ['bill', ['bolletta', 'fattura', 'rechnung', 'invoice', 'bill']],
];
/** Legal forms that mark a line as the name of an organisation. */
const ORGANISATION = /\b(s\.?p\.?a\.?|s\.?r\.?l\.?s?|s\.?n\.?c\.?|s\.?a\.?s\.?|gmbh|ag|kg|ohg|e\.?\s?v\.?|ug|ltd\.?|limited|llc|inc\.?|plc|co\.)(?=\s|$|,)/i;
const CURRENCIES: Readonly<Record<string, string>> = { '€': 'EUR', eur: 'EUR', euro: 'EUR', '£': 'GBP', gbp: 'GBP', chf: 'CHF', fr: 'CHF', $: 'USD', usd: 'USD' };

interface Line {
  readonly text: string;
  readonly folded: string;
  readonly page: number;
}

function linesOf(text: string): Line[] {
  return text.split(PAGE_SEPARATOR).flatMap((pageText, index) =>
    pageText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
      .map((line) => ({ text: line, folded: foldSearchText(line), page: index + 1 })),
  );
}

const excerpt = (line: string) => ([...line].length > MAX_EXCERPT ? `${[...line].slice(0, MAX_EXCERPT - 1).join('')}…` : line);

const pad = (value: number) => String(value).padStart(2, '0');

/** A calendar date that exists, between 1990 and 2100, as `YYYY-MM-DD`. */
function isoDate(year: number, month: number, day: number): string | undefined {
  if (year < 100) year += 2000;
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return undefined;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Dates in a (folded) piece of text, in order: 15/08/2026, 15.08.2026, 15-08-26, 2026-08-15, 15 agosto 2026, 1. November 2026, Sep 12, 2026. Day before month for numbers (as in Europe and the UK). */
export function datesIn(folded: string): string[] {
  const found: { at: number; date: string }[] = [];
  const add = (at: number, date: string | undefined) => {
    if (date !== undefined) found.push({ at, date });
  };
  for (const match of folded.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) add(match.index, isoDate(Number(match[1]), Number(match[2]), Number(match[3])));
  for (const match of folded.matchAll(/(?<![\d-])(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?![\d-])/g)) add(match.index, isoDate(Number(match[3]), Number(match[2]), Number(match[1])));
  for (const match of folded.matchAll(/\b(\d{1,2})\.?\s+([a-z]{3,9})\.?\s+(\d{4})\b/g)) {
    const month = MONTHS[match[2] ?? ''];
    if (month !== undefined) add(match.index, isoDate(Number(match[3]), month, Number(match[1])));
  }
  for (const match of folded.matchAll(/\b([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const month = MONTHS[match[1] ?? ''];
    if (month !== undefined) add(match.index, isoDate(Number(match[3]), month, Number(match[2])));
  }
  return found.sort((a, b) => a.at - b.at).map((each) => each.date);
}

/** The first date after one of `words` on a line (or on the next line, when the word ends its line). */
function dateAfter(lines: readonly Line[], words: readonly string[]): { date: string; line: Line } | undefined {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === undefined) continue;
    for (const word of words) {
      const at = wordAt(line.folded, word);
      if (at === -1) continue;
      const [date] = datesIn(line.folded.slice(at + word.length));
      if (date !== undefined) return { date, line };
      const next = lines[index + 1];
      const [following] = next !== undefined && next.page === line.page ? datesIn(next.folded) : [];
      if (following !== undefined && next !== undefined && line.folded.slice(at + word.length).replace(/[\s:.]/g, '') === '') return { date: following, line: next };
    }
  }
  return undefined;
}

/** Where `word` stands as a whole word (or phrase) in `folded`, or -1. */
function wordAt(folded: string, word: string): number {
  const match = new RegExp(`(?<![\\p{L}\\p{N}])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').exec(folded);
  return match?.index ?? -1;
}

/** `87,40`, `1.234,56`, `1,234.56`, `87.40`, `87` → cents; undefined for anything else. */
function cents(number: string): number | undefined {
  const compact = number.replace(/[\s']/g, '');
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})+,\d{2}$/.test(compact) || /^\d+,\d{2}$/.test(compact)) normalized = compact.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+\.\d{2}$/.test(compact) || /^\d+\.\d{2}$/.test(compact)) normalized = compact.replace(/,/g, '');
  else if (/^\d+$/.test(compact)) normalized = compact;
  else return undefined;
  const value = Math.round(Number(normalized) * 100);
  return Number.isSafeInteger(value) && value > 0 && value < 100_000_000_00 ? value : undefined;
}

/** An amount with its currency right before or after it, in a piece of (folded) text. */
function amountIn(folded: string): string | undefined {
  const currency = String.raw`(€|eur|euro|£|gbp|chf|fr\.?|\$|usd)`;
  const number = String.raw`(\d{1,3}(?:[.,' ]\d{3})*(?:[.,]\d{2})?)`;
  const match = new RegExp(`${currency}\\s?${number}(?![\\d])|${number}\\s?${currency}(?![a-z])`, 'u').exec(folded);
  if (match === null) return undefined;
  const code = CURRENCIES[(match[1] ?? match[4] ?? '').replace('.', '')];
  const value = cents(match[2] ?? match[3] ?? '');
  if (code === undefined || value === undefined) return undefined;
  return `${(value / 100).toFixed(2)} ${code}`;
}

/** The name of whoever issued the document: an early line on page 1 with a legal form (S.p.A., GmbH, Ltd …). */
function supplierOf(lines: readonly Line[]): Line | undefined {
  return lines.slice(0, 15).find((line) => line.page === 1 && ORGANISATION.test(line.text) && line.text.length <= 100 && !/\d{4,}/.test(line.text));
}

/** The document's type and the word on the paper that says so (for a title). */
function typeOf(lines: readonly Line[]): { type: BuiltInDocumentType; word: string; line: Line } | undefined {
  // The first lines say what a document is; further down "fattura" may merely be mentioned.
  const head = lines.filter((line) => line.page === 1).slice(0, 25);
  for (const [type, words] of TYPE_WORDS) {
    for (const line of head) {
      for (const word of words) {
        const at = wordAt(line.folded, word);
        if (at !== -1) return { type, word: line.text.slice(at, at + word.length), line };
      }
    }
  }
  return undefined;
}

/**
 * Suggestions for a Document from the recognised text of its first file (pages separated by
 * `PAGE_SEPARATOR`), at most one per field. Nothing is suggested from text that does not clearly say it.
 */
export function suggestFromText(text: string): DocumentSuggestion[] {
  const lines = linesOf(text);
  const suggestions: DocumentSuggestion[] = [];
  const add = (field: SuggestionField, value: string, line: Line) => suggestions.push({ field, value, page: line.page, excerpt: excerpt(line.text) });
  const kind = typeOf(lines);
  const supplier = supplierOf(lines);
  if (kind !== undefined) add('type', kind.type, kind.line);
  if (supplier !== undefined) add('supplier', supplier.text, supplier);
  if (kind !== undefined && supplier !== undefined) {
    const word = kind.word.charAt(0).toUpperCase() + kind.word.slice(1).toLowerCase();
    add('title', `${word} ${supplier.text}`.slice(0, 200), kind.line);
  }
  const due = dateAfter(lines, DUE_WORDS);
  if (due !== undefined) add('dueDate', due.date, due.line);
  const issued = dateAfter(lines, DATE_WORDS);
  if (issued !== undefined && issued.date !== due?.date) add('documentDate', issued.date, issued.line);
  for (const line of lines) {
    const word = AMOUNT_WORDS.find((candidate) => wordAt(line.folded, candidate) !== -1);
    if (word === undefined) continue;
    const amount = amountIn(line.folded.slice(wordAt(line.folded, word) + word.length));
    if (amount !== undefined) {
      add('amount', amount, line);
      break;
    }
  }
  return suggestions;
}

/** How a dismissed suggestion is remembered: the field and the folded value (a reread that finds the same thing stays dismissed). */
export const suggestionKey = (field: SuggestionField, value: string): string => `${field}:${foldSearchText(value).trim()}`.slice(0, 300);

export function parseSuggestionField(value: string): SuggestionField | undefined {
  return (SUGGESTION_FIELDS as readonly string[]).includes(value) ? (value as SuggestionField) : undefined;
}
