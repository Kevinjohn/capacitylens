import { parseResourceAvatarUrl } from "@capacitylens/shared/domain/resourceAvatarUrl";
import type { Db } from "../db";

/** Map a provider picture claim: valid HTTPS updates while absent or invalid input clears. */
export function mapExternalAvatar(value: unknown): { image?: string } {
  const parsed = parseResourceAvatarUrl(value);
  return { image: ((parsed.ok ? parsed.value : null) ?? null) as unknown as string };
}

/** Persist only the avatar claim for an existing provider/subject link; identity fields remain local-authority. */
export function persistLinkedExternalAvatar(input: { db: Db; providerId: string; subject: string; value: unknown }): {
  image?: string;
} {
  const mapped = mapExternalAvatar(input.value);
  const image = (mapped as { image: string | null }).image;
  input.db
    .prepare(
      `UPDATE user SET image = ?, updatedAt = ? WHERE id = (
         SELECT userId FROM account WHERE providerId = ? AND accountId = ? LIMIT 1
       )`,
    )
    .run(image, new Date().toISOString(), input.providerId, input.subject);
  return mapped;
}
