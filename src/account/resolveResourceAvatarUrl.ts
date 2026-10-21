import type { Resource } from "@capacitylens/shared/types/entities";

/** A person's own stored avatar wins over the linked-member projection; non-people have none. */
export function resolveResourceAvatarUrl(
  resource: Resource,
  resourceAvatars: ReadonlyMap<string, string>,
): string | undefined {
  return resource.kind === "person" ? (resource.avatarUrl ?? resourceAvatars.get(resource.id)) : undefined;
}
