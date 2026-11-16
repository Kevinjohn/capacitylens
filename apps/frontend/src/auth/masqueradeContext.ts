// Written only by the masquerade controller, through its injected `setContextToken`; the data layer
// receives `getMasqueradeContextToken` as an injected reader rather than importing this module.
let currentContextToken: string | null = null;

/** Retain the latest context proof established by a current, validated status response. */
export function setMasqueradeContextToken(token: string | null): void {
  currentContextToken = token;
}

/** Capture the current mode boundary when an API action is dispatched. */
export function getMasqueradeContextToken(): string | null {
  return currentContextToken;
}
