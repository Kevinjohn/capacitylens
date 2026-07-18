import type { Db } from '../db'
import { countUsers } from '../auth'
import { hasLivePreauthorizedInvitation } from './sqliteAccountAdminPort'
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation'

export interface ExternalIdentityCandidate {
  email?: string
  emailVerified?: boolean
}

/**
 * Embedded admission coordinator used before the identity adapter creates a federated local
 * principal. Identity storage owns the "first principal" fact; the account adapter owns the
 * invitation fact. Email authorizes admission but is never the durable link key.
 */
export function localExternalIdentityAdmission(input: {
  db: Db
  bootstrapEmails: string | undefined
  candidate: ExternalIdentityCandidate
}): boolean {
  if (input.candidate.emailVerified !== true || !input.candidate.email) return false
  const normalizedEmail = normalizeAccountEmail(input.candidate.email)
  if (!isAccountEmail(normalizedEmail)) return false
  const allowList = (input.bootstrapEmails ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  // First-owner admission is a distinct operator ceremony. A pre-existing/dangling invitation
  // must never replace the explicit bootstrap allow-list merely because the local user table is
  // empty (for example after erasure or while restoring control-plane data).
  if (countUsers(input.db) === 0) return allowList.includes(normalizedEmail)
  return hasLivePreauthorizedInvitation(input.db, normalizedEmail)
}
