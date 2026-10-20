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

/** Return whether a value is a bounded identifier without whitespace or controls. */
export const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256 && !/[\s\p{C}]/u.test(value);

/** Return whether a value exactly matches one of the supplied choices. */
export const isOneOf = (value: unknown, choices: readonly unknown[]) => choices.includes(value);
