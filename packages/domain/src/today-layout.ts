import { DomainValidationError } from './errors.ts';

/**
 * A person's Today layout (19.2): which cards they see, in which order, how wide and with which options.
 * Personal presentation only — it can never make a card of a switched-off tool appear (the tool gate is
 * the server's, on every route). Written strictly; a layout saved by an earlier version is read
 * tolerantly by the client, which merges it with the card registry.
 */
export const TODAY_LAYOUT_VERSION = 1;

/** Every card the server accepts in a saved layout. Later versions add ids; none is ever reused. */
export const TODAY_CARD_IDS = ['attention', 'continue', 'next', 'toBuy', 'maintenance', 'recent', 'progress', 'calendar', 'clock', 'weather'] as const;
export type TodayCardId = (typeof TODAY_CARD_IDS)[number];

export const TODAY_DENSITIES = ['COMPACT', 'COMFORTABLE'] as const;
export type TodayDensity = (typeof TODAY_DENSITIES)[number];

export const TODAY_CARD_SIZES = ['NORMAL', 'WIDE'] as const;
export type TodayCardSize = (typeof TODAY_CARD_SIZES)[number];

/** Recently completed: since local midnight, the last 24 hours, 3 days (default, T2) or 7 days — or off. */
export const RECENT_RETENTIONS = ['TODAY', 'HOURS_24', 'DAYS_3', 'DAYS_7', 'OFF'] as const;
export type RecentRetention = (typeof RECENT_RETENTIONS)[number];

export const TO_BUY_LISTS_MIN = 1;
export const TO_BUY_LISTS_MAX = 10;

export interface TodayCardOptions {
  /** To buy: how many Lists the card shows. */
  readonly lists?: number;
  /** Recently completed: how far back. */
  readonly retention?: RecentRetention;
  /** Clock & date (19.3): always 24-hour instead of the locale's choice. */
  readonly hour24?: boolean;
}

export interface TodayCardChoice {
  readonly id: TodayCardId;
  readonly visible: boolean;
  readonly size: TodayCardSize;
  readonly options: TodayCardOptions;
}

export interface TodayLayout {
  readonly version: number;
  readonly density: TodayDensity;
  readonly cards: readonly TodayCardChoice[];
}

/** Bounds the stored JSON whatever later versions add. */
export const TODAY_LAYOUT_MAX_BYTES = 4096;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function refuse(field: string): never {
  throw new DomainValidationError(field, 'invalid_today_layout', 'The Today layout is not valid');
}

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) refuse(field);
}

function oneOf<T extends string>(values: readonly T[], value: unknown, field: string): T {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) refuse(field);
  return value as T;
}

function optionsOf(id: TodayCardId, value: unknown): TodayCardOptions {
  if (value === undefined) return {};
  if (!isRecord(value)) refuse('options');
  switch (id) {
    case 'toBuy': {
      onlyKeys(value, ['lists'], 'options');
      if (value.lists === undefined) return {};
      if (typeof value.lists !== 'number' || !Number.isInteger(value.lists) || value.lists < TO_BUY_LISTS_MIN || value.lists > TO_BUY_LISTS_MAX) refuse('options.lists');
      return { lists: value.lists };
    }
    case 'recent':
      onlyKeys(value, ['retention'], 'options');
      return value.retention === undefined ? {} : { retention: oneOf(RECENT_RETENTIONS, value.retention, 'options.retention') };
    case 'clock':
      onlyKeys(value, ['hour24'], 'options');
      if (value.hour24 === undefined) return {};
      if (typeof value.hour24 !== 'boolean') refuse('options.hour24');
      return { hour24: value.hour24 };
    default:
      onlyKeys(value, [], 'options');
      return {};
  }
}

/** Strict: unknown fields, unknown or repeated cards and invalid options are refused, never dropped. */
export function parseTodayLayout(input: unknown): TodayLayout {
  if (!isRecord(input)) refuse('layout');
  onlyKeys(input, ['version', 'density', 'cards'], 'layout');
  if (input.version !== TODAY_LAYOUT_VERSION) refuse('version');
  const density = oneOf(TODAY_DENSITIES, input.density, 'density');
  if (!Array.isArray(input.cards) || input.cards.length > TODAY_CARD_IDS.length) refuse('cards');
  const seen = new Set<string>();
  const cards = input.cards.map((card: unknown): TodayCardChoice => {
    if (!isRecord(card)) refuse('cards');
    onlyKeys(card, ['id', 'visible', 'size', 'options'], 'cards');
    const id = oneOf(TODAY_CARD_IDS, card.id, 'cards.id');
    if (seen.has(id)) refuse('cards.id');
    seen.add(id);
    if (typeof card.visible !== 'boolean') refuse('cards.visible');
    const size = card.size === undefined ? 'NORMAL' : oneOf(TODAY_CARD_SIZES, card.size, 'cards.size');
    return { id, visible: card.visible, size, options: optionsOf(id, card.options) };
  });
  const layout: TodayLayout = { version: TODAY_LAYOUT_VERSION, density, cards };
  if (JSON.stringify(layout).length > TODAY_LAYOUT_MAX_BYTES) refuse('layout');
  return layout;
}
