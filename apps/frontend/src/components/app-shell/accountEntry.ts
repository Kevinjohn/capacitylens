import { useEffect, useRef, useState } from 'react';
import type { useNavigate } from 'react-router-dom';
import { clearJoinedAccountHandoff, readJoinedAccountHandoff } from '@/lib/joinedAccountHandoff';
import { transitionAccount } from '@/auth/accountTransition';
import type { StoreState } from '@/store/types';

// Which company the shell enters at bootstrap: a joined-account handoff from the URL, or the only
// company once the directory proves there is exactly one.

interface JoinedAccountHandoffInput {
  companySummaries: StoreState['companySummaries'];
  activeCompanyId: StoreState['activeCompanyId'];
  hash: string;
  hydrated: boolean;
  navigate: ReturnType<typeof useNavigate>;
  pathname: string;
  search: string;
}

/** Enters the company named by a joined-account handoff once, then removes it from the URL. */
export function useJoinedAccountHandoff(input: JoinedAccountHandoffInput) {
  const { companySummaries, activeCompanyId, hash, hydrated, navigate, pathname, search } = input;
  const [joinedAccountHandoff] = useState(() => readJoinedAccountHandoff(search));
  const joinedAccountUrlCleaned = useRef(false);
  const joinedAccountHandoffConsumed = useRef(false);
  const initialActiveCompanyId = useRef(activeCompanyId);

  useEffect(() => {
    if (!joinedAccountHandoff || joinedAccountUrlCleaned.current) return;
    joinedAccountUrlCleaned.current = true;
    void navigate({ pathname, search: clearJoinedAccountHandoff(search), hash }, { replace: true });
  }, [hash, joinedAccountHandoff, navigate, pathname, search]);

  useEffect(() => {
    // Wait for persistence hydration so the switch cannot race an older bootstrap replacement.
    if (!hydrated || !joinedAccountHandoff || joinedAccountHandoffConsumed.current) return;
    const userSelectedAnotherAccount =
      activeCompanyId !== null &&
      activeCompanyId !== joinedAccountHandoff &&
      activeCompanyId !== initialActiveCompanyId.current;
    if (userSelectedAnotherAccount) {
      joinedAccountHandoffConsumed.current = true;
      return;
    }
    if (!companySummaries.some((account) => account.id === joinedAccountHandoff)) return;

    joinedAccountHandoffConsumed.current = true;
    void transitionAccount(joinedAccountHandoff);
  }, [companySummaries, activeCompanyId, hydrated, joinedAccountHandoff]);

  return joinedAccountHandoff;
}

interface SingleAccountReloadInput {
  companySummaries: StoreState['companySummaries'];
  companySummariesComplete: boolean;
  activeCompanyId: StoreState['activeCompanyId'];
  hydrated: boolean;
}

interface ResolveSingleAccountForReloadInput {
  companySummaries: StoreState['companySummaries'];
  companySummariesComplete: boolean;
  activeCompanyId: StoreState['activeCompanyId'];
}

function resolveSingleAccountForReload(input: ResolveSingleAccountForReloadInput) {
  const account = input.companySummaries[0];
  if (
    input.activeCompanyId !== null ||
    !input.companySummariesComplete ||
    input.companySummaries.length !== 1 ||
    account?.roleStatus === 'unavailable'
  ) {
    return undefined;
  }
  return account;
}

/** Enters the only company after a reload when the complete directory lists exactly one. */
export function useSingleAccountReload(input: SingleAccountReloadInput) {
  const { companySummaries, companySummariesComplete, activeCompanyId, hydrated } = input;
  const singleAccountReloadHandled = useRef(false);

  useEffect(() => {
    if (activeCompanyId !== null) singleAccountReloadHandled.current = false;
    if (!hydrated || singleAccountReloadHandled.current) return;
    if (companySummaries.length === 0) return;

    const account = resolveSingleAccountForReload({
      companySummaries,
      companySummariesComplete,
      activeCompanyId,
    });
    if (!account) return;

    singleAccountReloadHandled.current = true;
    void transitionAccount(account.id);
  }, [companySummaries, companySummariesComplete, activeCompanyId, hydrated]);
}
