import { randomUUID } from 'node:crypto'
import type { ApiClient } from '@japa/api-client'
import { companyId, intentSession, type Credential } from '#tests/functional/planning/helpers'

/** The company a planning test writes to when it means some company other than its own. */
export const otherCompanyId = 'a-loft'

/** One planning mutation request body: a fresh mutation id, the revision it builds on and its intent. */
export const mutationInput = (baseRevision: number, intent: Record<string, unknown>) => ({
  mutationId: randomUUID(),
  baseRevision,
  intent,
})

/** Sends one planning mutation to the test company as `cookie`. */
export function mutate(client: ApiClient, cookie: Credential, revision: number, intent: object) {
  return intentSession(client.visit('api.planning_mutations.store', { companyId }), cookie)
    .json(mutationInput(revision, intent as Record<string, unknown>))
    .send()
}

/** The framework's validation answer: one entry per refused field. */
export const validationErrors = (response: { body(): unknown }) =>
  (response.body() as { errors?: Array<{ message: string }> }).errors

/** Reads a success answer inside its `data` envelope and a refusal as it stands. */
export const replyBody = (response: { body(): unknown; status(): number }) =>
  (response.status() < 300 ? (response.body() as { data: unknown }).data : response.body()) as {
    code: string
    revision: number
    error?: string
    status?: string
    mutationId?: string
    message?: string
  }
