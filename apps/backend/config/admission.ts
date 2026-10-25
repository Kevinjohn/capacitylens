import env from '#start/env'
import { defineAdmission } from 'adonisjs-account-kit/admission'
import { admissionAuthorize } from '#services/account_kit/policy'

// Comma-separated, for example `example.com,example.org`; unset leaves the domain requirement off.
const domains = (env.get('CAPACITYLENS_ALLOWED_EMAIL_DOMAINS') ?? '')
  .split(',')
  .map((domain) => domain.trim().toLowerCase())
  .filter(Boolean)

/** Every person needs an invitation and an Owner or Admin approval; bootstrap records both. */
export default defineAdmission({
  ...(domains.length > 0 ? { domain: { allowed: domains } } : {}),
  invitation: { required: true },
  approval: { required: true, authorize: admissionAuthorize },
})
