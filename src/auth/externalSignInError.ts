const MARKER = 'externalSignInError'
const PROVIDER_ERROR = 'error'
const PROVIDER_DESCRIPTION = 'error_description'

/** Return an application URL that an identity adapter may use for browser-visible callback errors. */
export function externalSignInErrorUrl(currentUrl: string): string {
  const url = new URL(currentUrl)
  url.searchParams.set(MARKER, '1')
  url.searchParams.delete(PROVIDER_ERROR)
  url.searchParams.delete(PROVIDER_DESCRIPTION)
  return url.toString()
}

/** Recognize only errors routed through our marked callback URL, not arbitrary product query data. */
export function hasExternalSignInError(url: string): boolean {
  const parsed = new URL(url)
  return parsed.searchParams.get(MARKER) === '1' && parsed.searchParams.has(PROVIDER_ERROR)
}

/** Remove provider-controlled error fields after rendering a stable, non-sensitive message. */
export function clearExternalSignInError(url: string): string {
  const parsed = new URL(url)
  parsed.searchParams.delete(MARKER)
  parsed.searchParams.delete(PROVIDER_ERROR)
  parsed.searchParams.delete(PROVIDER_DESCRIPTION)
  return parsed.toString()
}
