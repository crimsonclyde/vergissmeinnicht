import type { DocumentId } from './document.ts';
import { DomainValidationError } from './errors.ts';
import { BIDI_CONTROLS, CONTROL_CHARS } from './text.ts';
import { UUID_V4 } from './user.ts';

/**
 * Links (steps.md 16.5): a **reference** between two records of one Workspace — never a copy, and
 * never a grant: a Link gives nobody access to either end. So far one end is always a Document; the
 * other is a Procedure, a Schedule (a Reminder or a scheduled Procedure — shown on its Occurrences)
 * or another Document ("related").
 *
 * A **Run** is different: linking a Document to a Run **retains the Document version of that
 * moment** (its details and its files) beside the Run, so later edits or deletion of the Document
 * never change what the Run shows.
 */
export type LinkId = string & { readonly __brand: 'LinkId' };
export type RunDocumentId = string & { readonly __brand: 'RunDocumentId' };

/** What a Document can be linked to. Later tools add their record types here (a Contact since 16.6). */
export const LINK_TARGET_TYPES = ['document', 'procedure', 'schedule', 'contact'] as const;
export type LinkTargetType = (typeof LINK_TARGET_TYPES)[number];

export interface LinkTarget {
  readonly type: LinkTargetType;
  readonly id: string;
}

export type RunDocumentRemovalId = string & { readonly __brand: 'RunDocumentRemovalId' };
export const MAX_REMOVAL_REASON_LENGTH = 500;

/**
 * Why a Document version was removed from a finished Run (P4): required, plain single- or multi-line
 * text of 1–500 code points without control or bidi characters. It is kept for good in the removal
 * note — so it should say why, not what the document contained.
 */
export function normalizeRemovalReason(input: string): string {
  const reason = input.replace(/\r\n?/g, '\n').normalize('NFC').trim();
  if (reason.length === 0) throw new DomainValidationError('reason', 'removal_reason_required', 'A reason is required');
  if ([...reason].length > MAX_REMOVAL_REASON_LENGTH) throw new DomainValidationError('reason', 'removal_reason_too_long', 'The reason is too long');
  if (new RegExp(`(?![\\n\\t])${CONTROL_CHARS.source}`, 'u').test(reason) || BIDI_CONTROLS.test(reason)) throw new DomainValidationError('reason', 'removal_reason_invalid_characters', 'The reason contains control characters');
  return reason;
}

export const MAX_LINKS_PER_DOCUMENT = 50;
export const MAX_DOCUMENTS_PER_RUN = 20;

function parseId<T extends string>(value: string, field: string, code: string): T {
  if (!UUID_V4.test(value)) throw new DomainValidationError(field, code, 'Id must be a lower-case UUIDv4');
  return value as T;
}
export const parseLinkId = (value: string) => parseId<LinkId>(value, 'link', 'invalid_link_id');
export const parseRunDocumentId = (value: string) => parseId<RunDocumentId>(value, 'link', 'invalid_link_id');

export function parseLinkTarget(input: { readonly type: string; readonly id: string }): LinkTarget {
  if (!(LINK_TARGET_TYPES as readonly string[]).includes(input.type)) throw new DomainValidationError('target', 'invalid_link_target', 'Unknown kind of record');
  return { type: input.type as LinkTargetType, id: parseId<string>(input.id, 'target', 'invalid_link_target') };
}

/**
 * Two Documents are "related" in no particular direction: the pair is stored once, smaller id first,
 * so the same two can never be linked twice. A Document is never related to itself.
 */
export function relatedPair(a: DocumentId, b: DocumentId): readonly [DocumentId, DocumentId] {
  if (a === b) throw new DomainValidationError('target', 'link_to_itself', 'A document cannot be linked to itself');
  return a < b ? [a, b] : [b, a];
}
