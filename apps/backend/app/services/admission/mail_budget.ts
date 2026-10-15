const HOUR = 60 * 60 * 1000
const attempts = new Map<string, number[]>()

/** Reserves one invitation delivery attempt against company and recipient limits. */
export function reserveInvitationDelivery(
  accountId: string,
  email: string,
  now = Date.now()
): boolean {
  const keys: [string, number][] = [
    [`company:${accountId}`, 50],
    [`recipient:${accountId}:${email}`, 5],
  ]
  for (const [key, times] of attempts) {
    const live = times.filter((at) => at > now - HOUR)
    if (live.length) attempts.set(key, live)
    else attempts.delete(key)
  }
  if (keys.some(([key, limit]) => (attempts.get(key)?.length ?? 0) >= limit)) return false
  for (const [key] of keys) attempts.set(key, [...(attempts.get(key) ?? []), now])
  return true
}
