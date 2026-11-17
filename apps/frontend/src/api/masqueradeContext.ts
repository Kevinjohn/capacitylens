// Request context for the current view-as-member projection. Written only by the masquerade
// controller, through its injected `setContextToken`; any request code may read it at dispatch.
let currentContextToken: string | null = null;

/** Retain the latest context proof established by a current, validated status response. */
export function setMasqueradeContextToken(token: string | null): void {
  currentContextToken = token;
}

/** Capture the current mode boundary when an API action is dispatched. */
export function getMasqueradeContextToken(): string | null {
  return currentContextToken;
}
