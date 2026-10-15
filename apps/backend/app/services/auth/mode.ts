import env from '#start/env'

export type AuthMode = 'off' | 'password-only' | 'password-and-sso' | 'sso-only'

export function authMode(): AuthMode {
  return (env.get('CAPACITYLENS_MODE') || 'off') as AuthMode
}

export function passwordEnabled() {
  const mode = authMode()
  return mode === 'password-only' || mode === 'password-and-sso'
}

export function availableProviders() {
  // Provider admission and callbacks arrive in M3c. Configuration alone is not a usable method.
  return []
}
