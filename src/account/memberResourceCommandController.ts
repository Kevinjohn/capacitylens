/**
 * Coordinates account-scoped member/resource commands across surfaces.
 *
 * The lock is deliberately synchronous: React state is too late to prevent two
 * click handlers in the same event turn from submitting the same command.
 */
export type MemberResourceCommand = {
  isCurrent(): boolean;
  release(): void;
};

export function createMemberResourceCommandController() {
  let generation = 0;
  const pending = new Map<string, symbol>();
  return {
    invalidate() {
      generation += 1;
      pending.clear();
    },
    begin(key: string): MemberResourceCommand | null {
      if (pending.has(key)) return null;
      const commandGeneration = generation;
      const token = Symbol(key);
      pending.set(key, token);
      let released = false;
      return {
        isCurrent: () => commandGeneration === generation && pending.get(key) === token,
        release: () => {
          if (released) return;
          released = true;
          if (pending.get(key) === token) pending.delete(key);
        },
      };
    },
  };
}
