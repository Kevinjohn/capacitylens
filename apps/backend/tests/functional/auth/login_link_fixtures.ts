import db from '@adonisjs/lucid/services/db'

/** Seed inert credential material for the target and an unrelated principal. */
export async function seedLoginLinkProofs(targetId: string) {
  const otherId = crypto.randomUUID()
  const now = new Date().toISOString()
  await db.table('users').insert({
    id: otherId,
    email: `${otherId}@example.test`,
    email_verified: true,
    password_hash: null,
    display_name: 'Clark Kent',
    created_at: now,
    updated_at: now,
  })
  for (const id of [targetId, otherId]) {
    const user = await db.from('users').where('id', id).firstOrFail()
    await db.table('login_link_tokens').insert({
      tokenable_id: id,
      email: user.email,
      hash: crypto.randomUUID(),
      client_challenge: 'a'.repeat(43),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      created_at: now,
    })
  }
  return db.from('login_link_tokens').where('tokenable_id', otherId).firstOrFail()
}
