/** A display-safe validation failure with a stable path into the beta document. */
export class BetaTransferError extends Error {
  readonly path: string;
  constructor(path: string, message: string, options?: ErrorOptions) {
    super(`${path}: ${message}`, options);
    this.name = "BetaTransferError";
    this.path = path;
  }
}

/** Throw a display-safe validation error for one field path. */
export function fail(path: string, message: string): never {
  throw new BetaTransferError(path, message);
}

/** Assert an untrusted value satisfies a validation condition. */
export function assert(condition: unknown, path: string, message: string): asserts condition {
  if (!condition) fail(path, message);
}

/** Return whether an entity identifier can be addressed by the typed planning routes. */
export const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(value);

/** Return whether a plain object has its own property with this key. */
export const own = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

/** Return whether a value exactly matches one of the supplied choices. */
export const isOneOf = (value: unknown, choices: readonly unknown[]) => choices.includes(value);
