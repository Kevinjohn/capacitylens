/** Returns true when an untrusted collection repeats a logical identity. */
export function hasDuplicateIdentity<T>(items: readonly T[], identity: (item: T) => string): boolean {
  const seen = new Set<string>();
  for (const item of items) {
    const key = identity(item);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}
