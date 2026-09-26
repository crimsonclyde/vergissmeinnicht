import { inspect } from 'node:util';

const REDACTED = '[REDACTED]';

/**
 * Wraps a secret so it cannot leak through logging, string interpolation,
 * JSON serialization or `util.inspect`. Read it only where it is consumed.
 */
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}
