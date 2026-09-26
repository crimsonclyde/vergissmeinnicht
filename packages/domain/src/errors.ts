/** A value violated a domain invariant. `code` is stable and safe to expose; messages never echo input. */
export class DomainValidationError extends Error {
  readonly field: string;
  readonly code: string;

  constructor(field: string, code: string, message: string) {
    super(message);
    this.name = 'DomainValidationError';
    this.field = field;
    this.code = code;
  }
}
