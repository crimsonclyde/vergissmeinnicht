import { foldSearchText, parseSearchTerms } from './document-search.ts';
import { parseDocumentDate } from './document.ts';
import { DomainValidationError } from './errors.ts';
import { BIDI_CONTROLS, CONTROL_CHARS, normalizeSingleLineName } from './text.ts';
import { UUID_V4 } from './user.ts';
export type EquipmentId = string & {
    readonly __brand: 'EquipmentId';
};
export const EQUIPMENT_PAGE_SIZE = 50;
export const MAX_EQUIPMENT_RECORDS_PER_WORKSPACE = 20000;
export const MAX_EQUIPMENT_RECORDS_PER_PURGE = 200;
export const MAX_LINKS_PER_EQUIPMENT_RECORD = 50;
export interface EquipmentField { readonly label: string; readonly value: string }
export function parseEquipmentFields(input: unknown): readonly EquipmentField[] {
    if (!Array.isArray(input) || input.length > 16) throw new DomainValidationError('customFields', 'equipment_fields_invalid', 'Use at most 16 details');
    const seen = new Set<string>();
    return input.map((field: unknown) => {
        if (typeof field !== 'object' || field === null || Array.isArray(field) || Object.keys(field).length !== 2 || !Object.hasOwn(field, 'label') || !Object.hasOwn(field, 'value')) throw new DomainValidationError('customFields', 'equipment_fields_invalid', 'Invalid detail');
        const { label, value } = field as Record<string, unknown>;
        if (typeof label !== 'string' || typeof value !== 'string') throw new DomainValidationError('customFields', 'equipment_fields_invalid', 'Invalid detail');
        const normalized = { label: normalizeSingleLineName(label, { field: 'customFields', codePrefix: 'equipment_field', label: 'Label', maxLength: 60 }), value: normalizeSingleLineName(value, { field: 'customFields', codePrefix: 'equipment_field', label: 'Value', maxLength: 500 }) };
        const key = foldSearchText(normalized.label);
        if (seen.has(key)) throw new DomainValidationError('customFields', 'equipment_fields_invalid', 'Detail labels must be different');
        seen.add(key);
        return normalized;
    });
}
export const EQUIPMENT_LINK_TYPES = ['document', 'contact', 'maintenance', 'procedure', 'schedule'] as const;
export type EquipmentLinkType = (typeof EQUIPMENT_LINK_TYPES)[number];
export interface EquipmentContent {
    readonly name: string;
    readonly category: string;
    readonly location: string;
    readonly manufacturer: string;
    readonly model: string;
    readonly serialNumber: string;
    readonly purchaseDate: string | null;
    readonly warrantyExpiry: string | null;
    readonly notes: string;
    readonly replacementParts: string;
    readonly customFields: readonly EquipmentField[];
}
export type EquipmentInput = Pick<EquipmentContent, 'name'> & {
    [K in Exclude<keyof EquipmentContent, 'name'>]?: EquipmentContent[K] | undefined;
};
export function parseEquipmentId(id: string): EquipmentId {
    if (!UUID_V4.test(id))
        throw new DomainValidationError('equipment', 'invalid_equipment_id', 'Id must be a lower-case UUIDv4');
    return id as EquipmentId;
}
export function normalizeEquipmentContent(input: EquipmentInput): EquipmentContent {
    const line = (field: string, value: string, maxLength = 200) => value.trim() === '' ? '' : normalizeSingleLineName(value, { field, codePrefix: `equipment_${field}`, label: field, maxLength });
    const notes = (input.notes ?? '').replace(/\r\n?/g, '\n').normalize('NFC').trim();
    const replacementParts = (input.replacementParts ?? '').replace(/\r\n?/g, '\n').normalize('NFC').trim();
    if ([...replacementParts].length > 2000 || new RegExp(`(?![\\n\\t])${CONTROL_CHARS.source}`, 'u').test(replacementParts) || BIDI_CONTROLS.test(replacementParts)) throw new DomainValidationError('replacementParts', 'equipment_parts_invalid', 'Replacement details are invalid');
    if ([...notes].length > 4000)
        throw new DomainValidationError('notes', 'equipment_notes_too_long', 'Notes are too long');
    if (new RegExp(`(?![\\n\\t])${CONTROL_CHARS.source}`, 'u').test(notes) || BIDI_CONTROLS.test(notes))
        throw new DomainValidationError('notes', 'equipment_notes_invalid_characters', 'Notes contain control characters');
    return {
        name: normalizeSingleLineName(input.name, { field: 'name', codePrefix: 'equipment_name', label: 'Name', maxLength: 200 }),
        category: line('category', input.category ?? '', 60), location: line('location', input.location ?? ''),
        manufacturer: line('manufacturer', input.manufacturer ?? ''), model: line('model', input.model ?? ''),
        serialNumber: line('serialNumber', input.serialNumber ?? ''),
        purchaseDate: input.purchaseDate ? parseDocumentDate(input.purchaseDate) : null,
        warrantyExpiry: input.warrantyExpiry ? parseDocumentDate(input.warrantyExpiry) : null,
        notes,
        replacementParts,
        customFields: parseEquipmentFields(input.customFields ?? []),
    };
}
// Search intentionally excludes serial numbers and private free-form notes.
export const equipmentSearchText = (c: EquipmentContent) => foldSearchText([c.name, c.category, c.location, c.manufacturer, c.model, c.replacementParts].join('\n'));
export const equipmentCategoryKey = foldSearchText;
export interface EquipmentQuery {
    readonly terms: readonly string[];
    readonly category: string | null;
    readonly location: string | null;
    readonly manufacturer: string | null;
}
export function parseEquipmentQuery(input: {
    q?: string | undefined;
    category?: string | undefined;
    location?: string | undefined;
    manufacturer?: string | undefined;
}): EquipmentQuery {
    const key = (s: string | undefined) => s === undefined ? null : foldSearchText(normalizeSingleLineName(s, { field: 'filter', codePrefix: 'equipment_filter', label: 'Filter', maxLength: 200 }));
    return { terms: parseSearchTerms(input.q ?? ''), category: key(input.category), location: key(input.location), manufacturer: key(input.manufacturer) };
}
export interface EquipmentCursor {
    readonly value: string;
    readonly id: string;
}
export function parseEquipmentCursor(value: unknown): EquipmentCursor | undefined {
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || value[0].length > 400 || typeof value[1] !== 'string' || !UUID_V4.test(value[1]))
        return undefined;
    return { value: value[0], id: value[1] };
}
export function parseEquipmentLinkTarget(input: {
    type: string;
    id: string;
}): {
    type: EquipmentLinkType;
    id: string;
} {
    if (!(EQUIPMENT_LINK_TYPES as readonly string[]).includes(input.type) || !UUID_V4.test(input.id))
        throw new DomainValidationError('target', 'invalid_link_target', 'Unknown kind of record');
    return { type: input.type as EquipmentLinkType, id: input.id };
}
