import type { Entity } from "@capacitylens/shared/types/entities";

/** Detects an edit whose row disappeared or whose revision changed since the form opened. */
export function isStaleEdit<T extends Entity>(list: readonly T[], id: string, updatedAt: string): boolean {
  const current = list.find((candidate) => candidate.id === id);
  return !current || current.updatedAt !== updatedAt;
}
