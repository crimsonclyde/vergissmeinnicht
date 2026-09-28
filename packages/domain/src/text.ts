import { DomainValidationError } from './errors.ts';

export const CONTROL_CHARS = /\p{Cc}/u;
/**
 * Characters that are invisible or not text at all: control and format characters (zero-width
 * spaces and joiners, direction marks, soft hyphen), private-use, unassigned and lone surrogates, and
 * U+FFFD — what broken input (e.g. a mis-decoded paste in a terminal) turns into. Such characters make
 * two identifiers look identical while being different.
 */
export const INVISIBLE_OR_INVALID_CHARS = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Cs}\uFFFD]/u;
// Bidirectional overrides/isolates can make a name render as another one (e.g. in audit history).
export const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/u;

/**
 * Trim → NFC, 1..`maxLength` code points, no control or bidi override/isolate characters.
 * Error codes are `{codePrefix}_empty`, `{codePrefix}_too_long` and `{codePrefix}_invalid_characters`.
 */
export function normalizeSingleLineName(
  input: string,
  rule: { readonly field: string; readonly codePrefix: string; readonly label: string; readonly maxLength: number },
): string {
  const name = input.trim().normalize('NFC');
  if (name.length === 0) {
    throw new DomainValidationError(rule.field, `${rule.codePrefix}_empty`, `${rule.label} is required`);
  }
  if ([...name].length > rule.maxLength) {
    throw new DomainValidationError(rule.field, `${rule.codePrefix}_too_long`, `${rule.label} is too long`);
  }
  if (CONTROL_CHARS.test(name) || BIDI_CONTROLS.test(name)) {
    throw new DomainValidationError(
      rule.field,
      `${rule.codePrefix}_invalid_characters`,
      `${rule.label} contains control characters`,
    );
  }
  return name;
}
