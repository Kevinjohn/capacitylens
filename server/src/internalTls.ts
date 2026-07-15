import { readFileSync } from 'node:fs'
import type { ServerOptions as HttpsServerOptions } from 'node:https'

export type InternalTlsOptions = Pick<HttpsServerOptions, 'key' | 'cert' | 'minVersion'>

export class InternalTlsConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InternalTlsConfigError'
  }
}

type InternalTlsEnv = {
  CAPACITYLENS_INTERNAL_TLS_CERT?: string
  CAPACITYLENS_INTERNAL_TLS_KEY?: string
}

/**
 * Load the API's internal HTTPS identity. Both paths are required together; a partial or unreadable
 * configuration refuses startup instead of silently falling back to plaintext. Omitting both keeps
 * local development and same-host reverse-proxy deployments HTTP-compatible. Production warns when
 * both are absent, while the default Compose deployment supplies a per-install certificate set.
 */
export function loadInternalTls(
  env: InternalTlsEnv,
  read: (path: string) => Buffer = (path) => readFileSync(path),
): InternalTlsOptions | undefined {
  const certPath = env.CAPACITYLENS_INTERNAL_TLS_CERT?.trim()
  const keyPath = env.CAPACITYLENS_INTERNAL_TLS_KEY?.trim()

  if (!certPath && !keyPath) return undefined
  if (!certPath || !keyPath) {
    throw new InternalTlsConfigError(
      'CAPACITYLENS_INTERNAL_TLS_CERT and CAPACITYLENS_INTERNAL_TLS_KEY must be configured together.',
    )
  }

  let cert: Buffer
  let key: Buffer
  try {
    cert = read(certPath)
    key = read(keyPath)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new InternalTlsConfigError(`Unable to read the configured internal TLS identity: ${detail}`)
  }
  if (cert.length === 0 || key.length === 0) {
    throw new InternalTlsConfigError('The configured internal TLS certificate and key must not be empty.')
  }

  return { cert, key, minVersion: 'TLSv1.2' }
}
