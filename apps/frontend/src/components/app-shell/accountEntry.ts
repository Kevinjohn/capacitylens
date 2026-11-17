import { useEffect, useRef, useState } from 'react';
import type { useNavigate } from 'react-router-dom';
import { clearJoinedAccountHandoff, readJoinedAccountHandoff } from '@/lib/joinedAccountHandoff';
import { transitionAccount } from '@/auth/accountTransition';
import type { StoreState } from '@/store/types';

// Which company the shell enters at bootstrap: a joined-account handoff from the URL, or the only
// company once the directory proves there is exactly one.

interface JoinedAccountHandoffInput {
  accountSummaries: StoreState['accountSummaries'];
  activeAccountId: StoreState['activeAccountId'];
  hash: string;
  hydrated: boolean;
  navigate: ReturnType<typeof useNavigate>;
  pathname: string;
  search: string;
}

/** Enters the company named by a joined-account handoff once, then removes it from the URL. */
export function useJoinedAccountHandoff(input: JoinedAccountHandoffInput) {
  const { accountSummaries, activeAccountId, hash, hydrated, navigate, pathname, search } = input;
  const [joinedAccountHandoff] = useState(() => readJoinedAccountHandoff(search));
  const joinedAccountUrlCleaned = useRef(false);
  const joinedAccountHandoffConsumed = useRef(false);
  const initialActiveAccountId = useRef(activeAccountId);

  useEffect(() => {
    if (!joinedAccountHandoff || joinedAccountUrlCleaned.current) return;
    joinedAccountUrlCleaned.current = true;
    void navigate({ pathname, search: clearJoinedAccountHandoff(search), hash }, { replace: true });
  }, [hash, joinedAccountHandoff, navigate, pathname, search]);

  useEffect(() => {
    // Wait for persistence hydration so the switch cannot race an older bootstrap replacement.
    if (!hydrated || !joinedAccountHandoff || joinedAccountHandoffConsumed.current) return;
    const userSelectedAnotherAccount =
      activeAccountId !== null &&
      activeAccountId !== joinedAccountHandoff &&
      activeAccountId !== initialActiveAccountId.current;
    if (userSelectedAnotherAccount) {
      joinedAccountHandoffConsumed.current = true;
      return;
    }
    if (!accountSummaries.some((account) => account.id === joinedAccountHandoff)) return;

    joinedAccountHandoffConsumed.current = true;
    void transitionAccount(joinedAccountHandoff);
  }, [accountSummaries, activeAccountId, hydrated, joinedAccountHandoff]);

  return joinedAccountHandoff;
}

interface SingleAccountReloadInput {
  accountSummaries: StoreState['accountSummaries'];
  accountSummariesComplete: boolean;
  activeAccountId: StoreState['activeAccountId'];
  hydrated: boolean;
}

interface ResolveSingleAccountForReloadInput {
  accountSummaries: StoreState['accountSummaries'];
  accountSummariesComplete: boolean;
  activeAccountId: StoreState['activeAccountId'];
}

function resolveSingleAccountForReload(input: ResolveSingleAccountForReloadInput) {
  const account = input.accountSummaries[0];
  if (
    input.activeAccountId !== null ||
    !input.accountSummariesComplete ||
    input.accountSummaries.length !== 1 ||
    account?.roleStatus === 'unavailable'
  ) {
    return undefined;
  }
  return account;
}

/** Enters the only company after a reload when the complete directory lists exactly one. */
export function useSingleAccountReload(input: SingleAccountReloadInput) {
  const { accountSummaries, accountSummariesComplete, activeAccountId, hydrated } = input;
  const singleAccountReloadHandled = useRef(false);

  useEffect(() => {
    if (activeAccountId !== null) singleAccountReloadHandled.current = false;
    if (!hydrated || singleAccountReloadHandled.current) return;
    if (accountSummaries.length === 0) return;

    const account = resolveSingleAccountForReload({
      accountSummaries,
      accountSummariesComplete,
      activeAccountId,
    });
    if (!account) return;

    singleAccountReloadHandled.current = true;
    void transitionAccount(account.id);
  }, [accountSummaries, accountSummariesComplete, activeAccountId, hydrated]);
}
