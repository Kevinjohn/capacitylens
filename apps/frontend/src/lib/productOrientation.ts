/** Version segment for the persisted product-orientation dismissal key. */
export const PRODUCT_ORIENTATION_VERSION = 'v1'

const PRODUCT_ORIENTATION_PREFIX = `capacitylens/productOrientation/${PRODUCT_ORIENTATION_VERSION}`
/** Key segment used before a company is selected. */
export const NO_ACTIVE_COMPANY_SEGMENT = 'no-company'

/** Selects the stable identity scope for the product-orientation preference. */
export function resolveProductOrientationSubject(input: { userId: string | null }): string {
  return input.userId ?? 'local'
}

/** Builds the browser-storage key for one user and company. */
export function buildProductOrientationKey(subjectId: string, companyId: string): string {
  return `${PRODUCT_ORIENTATION_PREFIX}/${encodeURIComponent(subjectId)}/${encodeURIComponent(companyId)}`
}

/** Checks whether the user dismissed product orientation for a company. */
export function hasDismissedProductOrientation(subjectId: string, companyId: string): boolean {
  try {
    return localStorage.getItem(buildProductOrientationKey(subjectId, companyId)) === 'dismissed'
  } catch {
    // Unreadable optional orientation storage defaults to showing guidance; no company data is lost.
    return false
  }
}

/** Persists the dismissal for product orientation when browser storage is available. */
export function dismissProductOrientation(subjectId: string, companyId: string): boolean {
  try {
    localStorage.setItem(buildProductOrientationKey(subjectId, companyId), 'dismissed')
    return true
  } catch {
    // Return a failed dismissal result when optional storage is unavailable so the caller can report that the preference did not persist.
    return false
  }
}
