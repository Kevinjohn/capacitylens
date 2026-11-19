import type { FieldError } from '@/hooks/useFieldError';
import type { useStore } from '@/store/useStore';

/** Account and request capabilities required by member administration actions. */
export interface MemberActionDependencies {
  requestAccountId: () => string;
  isActiveCompany: (companyId: string) => boolean;
  withMemberAction: (key: string, body: (companyId: string) => Promise<void>) => Promise<void>;
  fail: FieldError['fail'];
  setNotice: ReturnType<typeof useStore.getState>['setNotice'];
}
