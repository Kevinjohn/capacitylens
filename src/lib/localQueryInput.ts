/** Maximum UTF-16 code units accepted by a local-only search input. */
export const MAX_LOCAL_QUERY_CODE_UNITS = 256;

/** Reject a pasted search query when replacing the selection would exceed its UTF-16 limit. */
export function rejectOverlongQueryPaste(event: React.ClipboardEvent<HTMLInputElement>): boolean {
  const input = event.currentTarget;
  const selectionStart = input.selectionStart ?? input.value.length;
  const selectionEnd = input.selectionEnd ?? input.value.length;
  const pastedLength = event.clipboardData.getData("text").length;
  const nextLength = input.value.length - (selectionEnd - selectionStart) + pastedLength;

  if (nextLength <= MAX_LOCAL_QUERY_CODE_UNITS) return false;
  event.preventDefault();
  return true;
}
