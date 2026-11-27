// Request context for the current view-as-member projection. Written only by the masquerade
// model, through its injected `setMasqueradeToken`; any request code may read it at dispatch.
let currentMasqueradeToken: string | null = null

/** Retain the latest context proof established by a current, validated status response. */
export function setMasqueradeToken(token: string | null): void {
  currentMasqueradeToken = token
}

/** Capture the current mode boundary when an API action is dispatched. */
export function getMasqueradeToken(): string | null {
  return currentMasqueradeToken
}
