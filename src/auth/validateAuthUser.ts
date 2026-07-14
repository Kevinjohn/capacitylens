import type { AuthUser } from './authContext'

export function validateAuthUser(value: unknown): AuthUser | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const user = value as Record<string, unknown>
  if (typeof user.id !== 'string' || user.id.trim().length === 0) return null
  if (user.name !== undefined && typeof user.name !== 'string') return null
  if (user.email !== undefined && typeof user.email !== 'string') return null
  return user as unknown as AuthUser
}
