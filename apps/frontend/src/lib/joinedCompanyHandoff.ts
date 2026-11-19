const JOINED_COMPANY_PARAM = 'joinedAccount';

/** Read the requested post-invite destination from a URL search string. Empty values are ignored. */
export function readJoinedCompanyHandoff(search: string): string | null {
  const value = new URLSearchParams(search).get(JOINED_COMPANY_PARAM);
  return value && value.length > 0 ? value : null;
}

/** Remove the one-use destination while preserving unrelated entry parameters. */
export function clearJoinedCompanyHandoff(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(JOINED_COMPANY_PARAM);
  const remaining = params.toString();
  return remaining.length > 0 ? `?${remaining}` : '';
}
