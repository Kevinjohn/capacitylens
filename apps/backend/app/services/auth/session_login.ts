import type { HttpContext } from '@adonisjs/core/http'
import type User from '#models/user'
import { withTransaction } from '#services/with_transaction'
import { registerProvenSession } from '#services/auth/session_authority'
import { recordMemberSignIn } from '#services/membership/sign_in_tracking'

/** Registers a native password session only while its credential proof remains current. */
export async function createPasswordSession(ctx: HttpContext, user: User, credentialHash: string) {
  const previousSessionId = ctx.session.sessionId
  await ctx.auth.use('web').login(user)
  const authenticatedAt = Date.now()
  const sessionId = ctx.session.sessionId
  ctx.session.put('authenticatedAt', authenticatedAt)
  ctx.session.put('lastActivityAt', authenticatedAt)
  await ctx.session.tag(String(user.id))
  await withTransaction(async (trx) => {
    await registerProvenSession(
      { userId: String(user.id), sessionId, credentialHash, authenticatedAt },
      trx
    )
    await recordMemberSignIn(String(user.id), trx)
    if (previousSessionId !== sessionId)
      await trx.from('user_session_index').where('session_id', previousSessionId).delete()
  })
}
