import { DomainValidationError } from './errors.ts';
import { GENERATED_ICON_KEYS } from './procedure-icon-keys.generated.ts';
import { CONTROL_CHARS, BIDI_CONTROLS, normalizeSingleLineName } from './text.ts';
import { UUID_V4 } from './user.ts';
import type { WorkspaceId } from './workspace.ts';

/**
 * A reusable, editable definition. Visible Workspace-wide to roles with `procedure.view` (no
 * per-Procedure ACLs in V1). Deletion is soft; historical Runs never depend on the row surviving.
 */
export type ProcedureId = string & { readonly __brand: 'ProcedureId' };

/**
 * Trusted icon keys. Clients map each key to their own artwork; no user-supplied SVG, HTML, URLs
 * or uploads (docs/development/security.md §5). The database holds the same keys in `procedure_icons` (every
 * icon column references it): a new key needs a migration that inserts it — keys are never removed.
 */
export const PROCEDURE_ICONS = [
  'checklist',
  'home',
  'kitchen',
  'cleaning',
  'laundry',
  'garden',
  'pet',
  'car',
  'travel',
  'tools',
  'health',
  'shopping',
  'document',
  'security',
  'star',
  // Added in 0.1.0-beta.4 (migration 0019).
  'power',
  'water',
  'gas',
  'heating',
  'internet',
  'wifi',
  'lights',
  'trash',
  'recycling',
  'door',
  'window',
  'key',
  'plant',
  'bed',
  'bath',
  'onboarding',
  'offboarding',
  'team',
  'work',
  'calendar',
  'mail',
  'phone',
  'school',
  'computer',
  'server',
  'backup',
  'update',
  'launch',
  'medication',
  'baby',
  'food',
  'coffee',
  'fitness',
  'fire-safety',
  'warning',
  'alarm',
  'bike',
  'weather',
  'snow',
  'sun',
  'delivery',
  'money',
  'clock',
  'settings',
  'camera',
  // Added in 0.2.0-beta.2 (migration 0021).
  'chimney',
  // Added with the Tabler icon set (migration 0022).
  'list',
  'clipboard',
  'flag',
  'target',
  'repeat',
  'hourglass',
  'reminder',
  'building',
  'sofa',
  'lamp',
  'stairs',
  'fence',
  'smart-home',
  'moving',
  'door-exit',
  'cooling',
  'meter',
  'solar',
  'battery',
  'ev-charging',
  'fridge',
  'freezer',
  'stove',
  'microwave',
  'blender',
  'dishes',
  'grill',
  'toilet-paper',
  'dental',
  'vacuum',
  'mop',
  'dryer',
  'ironing',
  'hanger',
  'flower',
  'tree',
  'leaf',
  'lawn-mower',
  'shovel',
  'wheelbarrow',
  'pool',
  'motorbike',
  'scooter',
  'bus',
  'truck',
  'camper',
  'fuel',
  'tire',
  'engine',
  'parking',
  'plane',
  'train',
  'ship',
  'tent',
  'beach',
  'mountain',
  'map',
  'passport',
  'ticket',
  'smoke-alarm',
  'first-aid',
  'ambulance',
  'lifebuoy',
  'helmet',
  'shield',
  'home-lock',
  'cctv',
  'password',
  'fingerprint',
  'wrench',
  'hammer',
  'drill',
  'ruler',
  'paint',
  'brush',
  'ladder',
  'axe',
  'sewing',
  'maintenance',
  'folder',
  'signature',
  'receipt',
  'tax',
  'certificate',
  'id-card',
  'printer',
  'wallet',
  'credit-card',
  'shopping-bag',
  'basket',
  'gift',
  'tag',
  'drink',
  'beer',
  'pizza',
  'bread',
  'fruit',
  'vegetables',
  'milk',
  'egg',
  'dog',
  'cat',
  'fish',
  'horse',
  'pet-food',
  'bug',
  'desktop',
  'tablet',
  'tv',
  'headphones',
  'router',
  'database',
  'cloud',
  'mailbox',
  'call',
  'message',
  'announcement',
  'family',
  'stroller',
  'gym',
  'vaccine',
  'thermometer',
  'heart',
  'mask',
  'wheelchair',
  'hospital',
  'rain',
  'storm',
  'wind',
  'night',
  'box',
  'boxes',
  'archive',
  'warehouse',
  'compost',
  'paper-waste',
  'book',
  'music',
  'puzzle',
  'trophy',
  'love',
  'party',
  'christmas',
  'candle',
  // Drawn household icons and the generated Tabler selection (migration 0023).
  'fan',
  'radiator',
  'boiler',
  'fuse-box',
  'valve',
  'shower',
  'sink',
  'dishwasher',
  'shutter',
  ...GENERATED_ICON_KEYS,
] as const;
export type ProcedureIcon = (typeof PROCEDURE_ICONS)[number];

/** The editable part of a Procedure. Sections and Steps follow in Step 4.2. */
export interface ProcedureContent {
  readonly title: string;
  readonly description: string;
  readonly icon: ProcedureIcon;
  readonly tags: readonly string[];
}

export interface Procedure extends ProcedureContent {
  readonly id: ProcedureId;
  readonly workspaceId: WorkspaceId;
  /** Increments on every edit; updates must name the revision they were based on (lost-update protection). */
  readonly revision: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function parseProcedureId(value: string): ProcedureId {
  if (!UUID_V4.test(value)) {
    throw new DomainValidationError('procedureId', 'invalid_procedure_id', 'Procedure id must be a lower-case UUIDv4');
  }
  return value as ProcedureId;
}

export const MAX_PROCEDURE_TITLE_LENGTH = 120;
export const MAX_PROCEDURE_DESCRIPTION_LENGTH = 4000;
export const MAX_PROCEDURE_TAGS = 10;
export const MAX_PROCEDURE_TAG_LENGTH = 32;

// Line feed and tab are the only control characters a description may contain.
const DISALLOWED_IN_DESCRIPTION = new RegExp(`(?![\\n\\t])${CONTROL_CHARS.source}`, 'u');

/** Plain text (rendered as text, never as HTML/Markdown). May be empty. */
export function normalizeProcedureDescription(input: string): string {
  const description = input.replace(/\r\n?/g, '\n').normalize('NFC').trim();
  if ([...description].length > MAX_PROCEDURE_DESCRIPTION_LENGTH) {
    throw new DomainValidationError('description', 'description_too_long', 'Description is too long');
  }
  if (DISALLOWED_IN_DESCRIPTION.test(description) || BIDI_CONTROLS.test(description)) {
    throw new DomainValidationError(
      'description',
      'description_invalid_characters',
      'Description contains control characters',
    );
  }
  return description;
}

export function parseProcedureIcon(value: string): ProcedureIcon {
  if (!(PROCEDURE_ICONS as readonly string[]).includes(value)) {
    throw new DomainValidationError('icon', 'invalid_icon', 'Unknown icon');
  }
  return value as ProcedureIcon;
}

/** Trimmed, NFC, single-line; duplicates (case-insensitive) are dropped keeping the first spelling. */
export function normalizeProcedureTags(input: readonly string[]): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    const tag = normalizeSingleLineName(raw, {
      field: 'tags',
      codePrefix: 'tag',
      label: 'Tag',
      maxLength: MAX_PROCEDURE_TAG_LENGTH,
    });
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  if (tags.length > MAX_PROCEDURE_TAGS) {
    throw new DomainValidationError('tags', 'too_many_tags', 'Too many tags');
  }
  return tags;
}

export function normalizeProcedureContent(input: {
  readonly title: string;
  readonly description: string;
  readonly icon: string;
  readonly tags: readonly string[];
}): ProcedureContent {
  return {
    title: normalizeSingleLineName(input.title, {
      field: 'title',
      codePrefix: 'procedure_title',
      label: 'Title',
      maxLength: MAX_PROCEDURE_TITLE_LENGTH,
    }),
    description: normalizeProcedureDescription(input.description),
    icon: parseProcedureIcon(input.icon),
    tags: normalizeProcedureTags(input.tags),
  };
}

const COPY_SUFFIX = ' (copy)';

/** Title of a duplicate: the original plus " (copy)", shortened so the result stays within the limit. */
export function copyTitle(title: string): string {
  const room = MAX_PROCEDURE_TITLE_LENGTH - [...COPY_SUFFIX].length;
  return `${[...title].slice(0, room).join('').trimEnd()}${COPY_SUFFIX}`;
}
