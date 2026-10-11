/** Version segment for the persisted product-orientation dismissal key. */
export const PRODUCT_ORIENTATION_VERSION = "v1";

const PRODUCT_ORIENTATION_PREFIX = `capacitylens/productOrientation/${PRODUCT_ORIENTATION_VERSION}`;
/** Key segment used before a company is selected. */
export const NO_ACTIVE_COMPANY_SEGMENT = "no-company";

/** Selects the stable identity scope for the product-orientation preference. */
export function resolveProductOrientationSubject(input: { userId: string | null; demo: boolean }): string {
  return input.userId ?? (input.demo ? "demo" : "local");
}

/** Builds the browser-storage key for one user and company. */
export function buildProductOrientationKey(subjectId: string, accountId: string): string {
  return `${PRODUCT_ORIENTATION_PREFIX}/${encodeURIComponent(subjectId)}/${encodeURIComponent(accountId)}`;
}

/** Checks whether the user dismissed product orientation for a company. */
export function hasDismissedProductOrientation(subjectId: string, accountId: string): boolean {
  try {
    return localStorage.getItem(buildProductOrientationKey(subjectId, accountId)) === "dismissed";
  } catch {
    return false;
  }
}

/** Persists the dismissal for product orientation when browser storage is available. */
export function dismissProductOrientation(subjectId: string, accountId: string): boolean {
  try {
    localStorage.setItem(buildProductOrientationKey(subjectId, accountId), "dismissed");
    return true;
  } catch {
    return false;
  }
}
