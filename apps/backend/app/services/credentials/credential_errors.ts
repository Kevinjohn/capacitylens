/** A command identity was already claimed by a completed issuance. */
export class CredentialConflictError extends Error {
  readonly status = 409
  readonly code = 'IDEMPOTENCY_CONFLICT'
  constructor() {
    super('That command has already been used.')
  }
}

/** Credential work or a committed follow-up needs operational attention. */
export class CredentialUnavailableError extends Error {
  readonly status = 503
  readonly code = 'CREDENTIAL_OPERATION_UNAVAILABLE'
  constructor(cause?: unknown) {
    super('Credential operation is temporarily unavailable.', { cause })
  }
}

/** An administrative command is missing a valid identity. */
export class CredentialInputError extends Error {
  readonly status = 400
  readonly code = 'INVALID_COMMAND_IDENTITY'
  constructor() {
    super('A valid command ID and idempotency key are required.')
  }
}

/** The actor cannot administer the target's full identity. */
export class CredentialAuthorityError extends Error {
  readonly status = 403
  readonly code = 'IDENTITY_AUTHORITY_DENIED'
  constructor() {
    super('You cannot administer this identity.')
  }
}
