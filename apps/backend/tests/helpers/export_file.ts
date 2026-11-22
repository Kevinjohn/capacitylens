/**
 * Returns an export document as the browser posts it: the file's JSON, where each row names its
 * company `companyId`, as the document does in memory. It does not validate, so tests can still
 * send deliberately broken documents.
 */
export function asExportFile<T>(document: T): T {
  return document;
}
