/**
 * Every message the HTTP routes author for a reply or a route-level failure.
 *
 * Messages are sentence case and end with a full stop; a leading wire identifier such as
 * `accountId` keeps its exact spelling. The client matches only `FROZEN_REPLY_MESSAGES` by text,
 * so those are re-exported unchanged and every other message here may be reworded.
 */
export { FROZEN_REPLY_MESSAGES } from "@capacitylens/shared/api/replyMessages";

export const REPLY_ERRORS = {
  // Generic transport and server failures.
  internalServerError: "Internal server error.",
  constraintViolation: "That change references missing data or conflicts with an existing record.",
  requestBodyTooLarge: "Request body is too large.",
  unsupportedMediaType: "Unsupported media type.",
  contentLengthMismatch: "Request body size did not match Content-Length.",
  emptyJsonBody: "Body cannot be empty when content-type is set to 'application/json'.",
  invalidJsonBody: "Body is not valid JSON but content-type is set to 'application/json'.",
  malformedCspReport: "Malformed CSP report.",
  rateLimited: "Rate limit exceeded.",
  crossSiteRequest: "Cross-site request rejected.",
  invalidRequestAuthority: "Invalid request authority.",

  // Account command headers.
  idempotencyKeyInvalid: "Idempotency-Key must be a 16–128 character opaque base64url-style identifier.",
  commandIdInvalid:
    "X-Account-Command-Id must be a 16–128 character independently generated, unguessable base64url-style identifier.",
  commandHeadersUnpaired: "Idempotency-Key and X-Account-Command-Id must be supplied together.",

  // Authentication and authorization.
  forbidden: "Forbidden.",
  /** 404 for a route that is switched off or not offered in this mode. Distinct from the frozen
   * `FROZEN_REPLY_MESSAGES.notFound`, which the client matches by text. */
  routeUnavailable: "Not found.",
  signInRequired: "Sign in to continue.",
  signInUnavailable: "Sign-in is temporarily unavailable.",
  freshSignInRequired: "Sign in again before performing this security-sensitive action.",
  mfaEnrollmentRequired: "Multi-factor authentication enrollment is required.",
  microsoftCallbackRequired: "Microsoft sign-in requires the authorization-code callback.",
  companyProviderRequired: "Sign in with a configured company provider.",
  ssoRequiredBeforeCompanyCreate: "Sign in with the required SSO provider before creating a company.",
  ssoRequiredBeforeInvitationAccept: "Sign in with the required SSO provider before accepting this invitation.",

  // Masquerade.
  masqueradeEnded: "Masquerade ended.",
  masqueradeReadOnly: "Masquerade is read-only.",
  masqueradeAlreadyActive: "This session is already masquerading.",
  masqueradeTargetRequired: "targetUserId must be a non-empty string.",
  masqueradeSelf: "You cannot masquerade as yourself.",
  masqueradeEndInvalid: "A valid token and end reason are required.",
  memberNotFound: "Member not found.",
  sessionExpiryUnverified: "The session expiry could not be verified.",

  // Entity and lifecycle writes.
  accountIdRequired: "accountId is required.",
  accountIdNonEmpty: "accountId must be a non-empty string.",
  accountIdRequiredForScopedDelete: "accountId is required to delete a scoped record.",
  includeInactiveInvalid: "includeInactive must be the literal value 1 when present.",
  staleWrite: "The record was modified more recently on the server.",
  useLifecycleEndpoints: "Use the dedicated lifecycle endpoints for this entity.",
  noDeletionPolicy: "No deletion policy is defined for this entity.",
  purgeTooRecent: "Cannot purge: must be a soft-deleted tombstone at least 30 days old.",
  /** Auth-on closure of the generic account-create paths. POST /api/orgs atomically creates an
   * account, its built-in Internal client and the owner membership; trusted-local mode retains
   * generic creation. */
  accountCreateClosed:
    "Accounts cannot be created through this endpoint when authentication is on. Use POST /api/orgs.",
  /** Frozen-field refusal shared by account PUT, PATCH and the batch loop. */
  accountFrozenFields: "Language, week start and time zone are set when the company is created and cannot be changed.",
  companyNotFound: "Company not found.",
  companyDetailsNotObject: "Company details must be an object.",
  gettingStartedDismissedInvalid: "dismissed must be true.",

  // Batch sync.
  batchOpsRequired: "ops array is required.",
  batchSyncHeadersInvalid: "Invalid browser sync ordering headers.",
  batchOpNotObject: "Each op must be an object.",
  batchOpTarget: "Each op needs a known table and string id.",
  batchPutRowRequired: "A request body is required.",
  batchPutRowIdMismatch: "Each PUT op needs a row whose id matches the op id.",
  batchDeleteLifecycle: "Use the dedicated lifecycle endpoints for lifecycle entities.",
  batchDeleteAccount: "Use the dedicated company deletion endpoint.",
  batchDeleteAccountId: "A scoped DELETE op needs a string accountId.",
  batchArchiveNotLifecycle: "ARCHIVE is supported only for lifecycle entities.",
  batchArchiveAccountId: "An ARCHIVE op needs a string accountId.",
  batchArchiveInternalClient: "The built-in Internal client cannot be archived.",
  batchInternalClientMismatch: "The same-batch built-in Internal client must match the generated server row.",
  batchNoWritePolicy: "No batch-write policy is defined for this entity.",

  // Import, reset and example data.
  importOwnerOnly: "Only the account owner can import data.",
  importDataInvalid: "The import data is not valid CapacityLens data.",
  importEmpty: "The import contained no usable records, so the company data was left unchanged.",
  importBusy: "Import preparation is temporarily at capacity. Retry shortly.",
  importSnapshotStale:
    "The company data changed while the import was being prepared. Retry the import from the latest data.",
  resetDisabled: "Reset is disabled.",
  exampleDataCompanyNotEmpty:
    "Example data can only be added to a company that has no people, clients, projects or allocations, including archived or deleted ones.",

  // Company joining.
  joiningRequestInvalid: "Invalid company joining request.",
  joiningCompanyUnavailable: "This company is unavailable.",
  joiningProviderUnavailable: "Provider joining is unavailable.",
  joiningProviderNotPermitted: "This provider is unavailable for company joining.",
  joiningProviderStartFailed: "Provider sign-in could not start.",
  joiningPasswordUnavailable: "Password joining is unavailable.",
  joiningPasswordSignInRequired: "Sign in with your password and complete MFA to continue.",
  joiningEmailVerificationUnavailable: "Email verification is unavailable.",
  joiningVerificationEmailsLimited: "Too many verification emails. Try again later.",
  joiningVerificationEmailFailed: "Verification email could not be sent.",
  joiningAddressNotVerifiable: "This address cannot be verified for this account.",
  joiningVerifiedProviderRequired: "Sign in with the verified provider to continue.",
  joiningMicrosoftRequired: "Sign in with Microsoft to continue.",
  microsoftConnectionFailed: "Microsoft connection could not continue.",

  // Account administration.
  notAMember: "Not a member of this account.",
  trustedLocalMemberManagement: "Member management is unavailable in trusted-local mode.",
  invalidRole: "role must be one of owner, admin, editor, viewer.",
  memberStatusInvalid: "status must be one of active, disabled, archived.",
  memberEnabledInvalid: "enabled must be a boolean.",
  reconcileInputInvalid: "A valid command, idempotency key, and operation are required.",
  commandNotFound: "Command not found.",
  invalidSessionId: "Invalid session id.",
  sessionsRequireAuthentication: "Sessions require authentication.",
  passwordResetUnavailable: "Password reset links require a deployment profile with password sign-in enabled.",
  joiningPolicyAuthenticationRequired: "Authentication is required.",
  joiningPolicyInvalid: "Choose a valid joining policy.",
  approvedDomainsInvalid: "Approved domains must be valid DNS domains.",
  resourceLinkInputInvalid: "resourceId and expectedRevision are required.",
  expectedRevisionRequired: "expectedRevision is required.",
  proposedResourceIdInvalid: "proposedResourceId must be a non-empty string.",
  preauthEmailInvalid: "preauthEmail must be a valid email address.",
  expiresAtInvalid: "expiresAt must be a valid ISO-8601 timestamp.",
  ssoInvitationRequiresEmail: "SSO-only onboarding requires an email-preauthorized invitation.",
  signupEmailInvalid: "A valid email address is required.",
  signupNameRequired: "Name is required.",
  ownershipTransferClosed: "This ownership transfer is no longer open.",
  ownershipTransferTargetRequired: "toUserId must be a non-empty string.",
  ownershipTransferReplacementInvalid:
    "expectedRequestId and expectedRevision must be supplied together as non-empty strings.",
  ownershipTransferRevisionRequired: "expectedRevision must be a non-empty string.",
} as const;

/** 404 body for a route parameter that names no generic or lifecycle entity. */
export function buildUnknownEntityMessage(entity: string): string {
  return `Unknown entity: ${entity}.`;
}

/** 409 body when the built-in Internal client is the target of a lifecycle transition. */
export function buildProtectedClientMessage(verb: string): string {
  return `The built-in Internal client cannot be ${verb}.`;
}

/** 400 body for a batch op whose method is not PUT, DELETE or ARCHIVE. */
export function buildUnknownOpMethodMessage(method: unknown): string {
  return `Unknown op method: ${String(method)}.`;
}

/** 400 body for an ordered batch op without the revision its sync sequence requires. */
export function buildOrderedRevisionMessage(method: string): string {
  return `An ordered ${method} op needs a string updatedAt revision.`;
}

/** 400 body for a batch larger than the protocol cap. */
export function buildBatchTooLargeMessage(maxOps: number): string {
  return `A batch may contain at most ${maxOps} operations.`;
}

/** 400 body for an invitation signup password outside the accepted length. */
export function buildPasswordLengthMessage(min: number, max: number): string {
  return `Password must be ${min}–${max} characters.`;
}
