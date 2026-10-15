import env from '#start/env'

export type AuthMode = 'off' | 'password-only' | 'password-and-sso' | 'sso-only'

export function authMode(): AuthMode {
  return (env.get('CAPACITYLENS_MODE') || 'off') as AuthMode
}

export function passwordEnabled() {
  const mode = authMode()
  return mode === 'password-only' || mode === 'password-and-sso'
}

export function googleEnabled() {
  const mode = authMode()
  return (
    (mode === 'password-and-sso' || mode === 'sso-only') &&
    Boolean(env.get('CAPACITYLENS_GOOGLE_CLIENT_ID')) &&
    Boolean(env.get('CAPACITYLENS_GOOGLE_CLIENT_SECRET'))
  )
}

export function availableProviders() {
  return googleEnabled()
    ? [{ id: 'google', label: 'Google', kind: 'social', brand: 'google', experimental: false }]
    : []
}
