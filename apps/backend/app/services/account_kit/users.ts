import { createLucidAdapter } from 'adonisjs-account-kit'
import { MAX_NAME_LENGTH } from '@capacitylens/shared/lib/strings'

/** The only registration field: a display name, which the sign-up routes have already validated. */
export function registrationDisplayName(data: unknown) {
  const name =
    data && typeof data === 'object' && typeof (data as { name?: unknown }).name === 'string'
      ? (data as { name: string }).name.trim()
      : ''
  if (!name || name.length > MAX_NAME_LENGTH) throw new Error('A display name is required.')
  return name
}

/** Account Kit's maintained Lucid adapter over the product user model and the default hasher. */
export const users = createLucidAdapter(
  async () => {
    const { default: User } = await import('#models/user')
    return User
  },
  {
    mapRegistrationData(data, user) {
      ;(user as unknown as { displayName: string }).displayName = registrationDisplayName(data)
    },
  }
)
