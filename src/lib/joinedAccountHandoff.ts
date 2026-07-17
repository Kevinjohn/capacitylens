const JOINED_ACCOUNT_PARAM = 'joinedAccount'

/** Build the one-use post-invite entry URL. The account id is only a requested destination: the
 * authenticated account list remains the authority before AppShell activates it. */
export function joinedAccountEntryPath(accountId: string): string {
  return `/?${JOINED_ACCOUNT_PARAM}=${encodeURIComponent(accountId)}`
}

/** Read the requested post-invite destination from a URL search string. Empty values are ignored. */
export function readJoinedAccountHandoff(search: string): string | null {
  const value = new URLSearchParams(search).get(JOINED_ACCOUNT_PARAM)
  return value && value.length > 0 ? value : null
}

/** Start the authenticated app boot that will verify and consume the requested destination. */
export function replaceWithJoinedAccount(accountId: string): void {
  window.location.replace(joinedAccountEntryPath(accountId))
}

/** Reboot into the ordinary authenticated company picker when no destination could be verified. */
export function replaceWithAccountPicker(): void {
  window.location.replace('/')
}

/** Reload the current bearer URL after sign-in so an invite is reviewed by the new session. Kept
 * behind this tiny boundary so transport-unknown invite recovery can be regression-tested without
 * attempting to navigate jsdom. */
export function reloadCurrentPage(): void {
  window.location.reload()
}
