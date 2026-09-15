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
  const pending = new Set<string>();
  return {
    invalidate() {
      generation += 1;
      pending.clear();
    },
    begin(key: string): MemberResourceCommand | null {
      if (pending.has(key)) return null;
      pending.add(key);
      const commandGeneration = generation;
      let released = false;
      return {
        isCurrent: () => commandGeneration === generation,
        release: () => {
          if (released) return;
          released = true;
          pending.delete(key);
        },
      };
    },
  };
}
