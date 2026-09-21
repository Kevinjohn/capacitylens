export const PRODUCT_ORIENTATION_VERSION = "v1";

const PRODUCT_ORIENTATION_PREFIX = `capacitylens/productOrientation/${PRODUCT_ORIENTATION_VERSION}`;
export const NO_ACTIVE_COMPANY_SEGMENT = "no-company";

export function resolveProductOrientationSubject(input: { userId: string | null; demo: boolean }): string {
  return input.userId ?? (input.demo ? "demo" : "local");
}

export function buildProductOrientationKey(subjectId: string, accountId: string): string {
  return `${PRODUCT_ORIENTATION_PREFIX}/${encodeURIComponent(subjectId)}/${encodeURIComponent(accountId)}`;
}

export function hasDismissedProductOrientation(subjectId: string, accountId: string): boolean {
  try {
    return localStorage.getItem(buildProductOrientationKey(subjectId, accountId)) === "dismissed";
  } catch {
    return false;
  }
}

export function dismissProductOrientation(subjectId: string, accountId: string): boolean {
  try {
    localStorage.setItem(buildProductOrientationKey(subjectId, accountId), "dismissed");
    return true;
  } catch {
    return false;
  }
}
