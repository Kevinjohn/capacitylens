import { test } from '@japa/runner'
import { verifiedGoogleProfile } from '#services/auth/google_identity'

const profile = {
  id: 'google-subject-1',
  email: 'bruce.wayne@wayne.example',
  name: 'Bruce Wayne',
  emailVerificationState: 'verified',
  original: { sub: 'google-subject-1', email_verified: true },
}

test.group('Google identity proof', () => {
  test('accepts the stable subject and exact boolean verified mailbox claim', ({ assert }) => {
    assert.deepEqual(verifiedGoogleProfile(profile), {
      subject: 'google-subject-1',
      email: profile.email,
      name: profile.name,
    })
  })

  test('rejects truthy string claims, subject mismatch, and unverified mailboxes', ({ assert }) => {
    for (const value of [
      { ...profile, original: { ...profile.original, email_verified: 'false' } },
      { ...profile, original: { ...profile.original, sub: 'different' } },
      { ...profile, emailVerificationState: 'unverified' },
    ])
      assert.throws(() => verifiedGoogleProfile(value), 'Google did not verify this identity.')
  })
})
