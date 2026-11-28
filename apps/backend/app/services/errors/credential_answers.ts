import type { ProductHttpErrorBody } from '@capacitylens/shared/api/httpErrors'

/** The body for an invitation link that is invalid or has expired. */
export const invalidLinkAnswer = {
  error: 'This link is invalid or expired.',
  code: 'E_INVALID_TOKEN',
} satisfies ProductHttpErrorBody
