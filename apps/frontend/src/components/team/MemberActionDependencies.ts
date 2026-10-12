import type { FieldError } from "@/hooks/useFieldError";
import type { useStore } from "@/store/useStore";

/** Account and request capabilities required by member administration actions. */
export interface MemberActionDependencies {
  requestAccountId: () => string;
  isActiveAccount: (accountId: string) => boolean;
  withMemberAction: (key: string, body: (accountId: string) => Promise<void>) => Promise<void>;
  fail: FieldError["fail"];
  setNotice: ReturnType<typeof useStore.getState>["setNotice"];
}
