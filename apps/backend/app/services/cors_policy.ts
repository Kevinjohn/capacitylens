import env from '#start/env'

const defaultOrigins =
  'http://localhost:5173,http://localhost:5273,http://127.0.0.1:5173,http://127.0.0.1:5273'

export const corsOrigins = (env.get('CAPACITYLENS_CORS_ORIGIN') ?? defaultOrigins)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => {
    if (origin === '*')
      throw new Error('CORS requires explicit origins when credentials are enabled')
    const parsed = new URL(origin)
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    )
      throw new Error(
        `Invalid CORS origin ${JSON.stringify(origin)}: expected a bare HTTP(S) origin`
      )
    return parsed.origin
  })

interface TrustedOriginInput {
  origin?: string
  fetchSite?: string
  host?: string
  protocol?: string
}

/** Resolves whether an unsafe browser request comes from an explicitly trusted origin. */
export function isTrustedUnsafeOrigin({ origin, fetchSite, host, protocol }: TrustedOriginInput) {
  if (!origin) return fetchSite !== 'cross-site'
  let normalizedOrigin: string
  try {
    normalizedOrigin = new URL(origin).origin
  } catch {
    return false
  }
  if (corsOrigins.includes(normalizedOrigin)) return true
  if (fetchSite === 'same-origin') return true
  if (!host || (protocol !== 'http' && protocol !== 'https')) return false
  let parsedOrigin: URL
  let reconstructed: URL
  try {
    parsedOrigin = new URL(origin)
    reconstructed = new URL(`${protocol}://${host}`)
  } catch {
    return false
  }
  if (parsedOrigin.origin === reconstructed.origin) return true
  return (
    parsedOrigin.protocol === 'https:' &&
    reconstructed.protocol === 'http:' &&
    parsedOrigin.host === reconstructed.host
  )
}
