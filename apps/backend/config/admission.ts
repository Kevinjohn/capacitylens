// The optional allowed email domain comes from `CAPACITYLENS_ALLOWED_EMAIL_DOMAINS`. When an
// existing limited account needs invitation evidence, the operator uses the kit's
// `grant-invitation` command.
//
// The first identity comes from the operator's bootstrap invitation, printed by
// `account-kit:admission:bootstrap`.

import env from '#start/env'
import { defineAdmission } from '@kevinjohn/adonisjs-account-kit/admission'

// Comma-separated, for example `example.com,example.org`; unset leaves the domain requirement off.
const domains = (env.get('CAPACITYLENS_ALLOWED_EMAIL_DOMAINS') ?? '')
  .split(',')
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean)

/** Every person needs an invitation and an Owner or Admin approval; bootstrap records both. */
export default defineAdmission({
  ...(domains.length > 0 ? { domain: { allowed: domains } } : {}),
  invitation: { required: true },
  approval: { required: true },
})
