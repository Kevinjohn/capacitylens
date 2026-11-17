import type { Resource } from '@capacitylens/shared/types/entities';

/** A person's stored avatar; other kinds have none. */
export function resolveResourceAvatarUrl(resource: Resource): string | undefined {
  return resource.kind === 'person' ? (resource.avatarUrl ?? undefined) : undefined;
}
