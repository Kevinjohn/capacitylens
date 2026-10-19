import { m } from "@/i18n";
import { useState } from "react";
import { accountClient, hasUnknownAccountCommandOutcome } from "@/account/accountClient";
import type { useAuth } from "@/auth/authContext";
import { refreshAccountSummaries } from "@/auth/useAccountSummaries";
import { isServerConfigured } from "@/data/apiConfig";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { readApiError } from "@/lib/readApiError";
import type { AccountSummary } from "@/store/useStore";
import { useStore } from "@/store/useStore";

/** Coordinates the company deletion request and its visible status. */
export function useDeleteAccount({ refreshAuth }: { refreshAuth: ReturnType<typeof useAuth>["refreshAuth"] }) {
  const deleteAccount = useStore((state) => state.deleteAccount);
  const setAccountSummaries = useStore((state) => state.setAccountSummaries);
  const setNotice = useStore((state) => state.setNotice);
  // Disable deletion controls while the server command is pending so another click cannot start an overlapping request.
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState<AccountSummary | null>(null);
  // Company deletion uses the owner-only deleteAccount capability and erases the tenant transactionally. Call the dedicated route because snapshot diffs cannot delete an unloaded company.
  const deleteOrgOnServer = async (id: string) => {
    if (deleting) return;
    setDeleting(true);
    try {
      // The account client applies the bulk timeout because whole-tenant erasure can legitimately
      // outlive the interactive request bound while its transaction completes.
      const res = await accountClient.eraseWorkspace(id);
      if (!res.ok) {
        if (hasUnknownAccountCommandOutcome(res)) {
          const fresh = await refreshAccountSummaries();
          await refreshAuth();
          setNotice(fresh !== null ? m.picker_delete_unknown_refreshed() : m.picker_delete_unknown_stale(), "warning");
          return;
        }
        setNotice((await readApiError(res)) ?? m.picker_err_delete({ status: res.status }), "error");
        return;
      }
      const summaries = useStore.getState().accountSummaries;
      const removedName = summaries.find((summary) => summary.id === id)?.name;
      setAccountSummaries({ list: summaries.filter((account) => account.id !== id) });
      if (removedName) setNotice(m.picker_delete_success({ name: removedName }), "info");
      // Company deletion changes the server creation capability, so recheck auth metadata before the picker offers the next action. refreshAuth preserves the previous snapshot on failure and never rejects.
      void refreshAuth();
    } catch (e) {
      // A timeout/abort says only that the browser stopped waiting. The transactional erasure may
      // already have committed server-side. Asserting "nothing was removed" here would leave a
      // now-deleted company in the picker (re-clicking it 403s) until a manual reload. Reconcile
      // instead: re-read the authoritative /api/accounts list and adopt it (the company drops out
      // if the erase committed; a failed re-read leaves the list untouched, same as before).
      const fresh = await refreshAccountSummaries();
      await refreshAuth();
      setNotice(
        fresh !== null
          ? `${m.picker_delete_unknown_refreshed()} ${resolveErrorMessage(e)}`
          : `${m.picker_delete_unknown_stale()} ${resolveErrorMessage(e)}`,
        "warning",
      );
    } finally {
      setDeleting(false);
      setConfirming((current) => (current?.id === id ? null : current));
    }
  };

  const confirmDelete = (id: string) => {
    if (isServerConfigured()) {
      void deleteOrgOnServer(id);
      return;
    }

    try {
      const removedName = useStore.getState().data.accounts.find((account) => account.id === id)?.name;
      deleteAccount(id);
      if (removedName) setNotice(m.picker_delete_success({ name: removedName }), "info");
      setConfirming(null);
    } catch (error) {
      // Surface a local cascade rejection instead of letting an event-handler exception escape.
      setNotice(resolveErrorMessage(error), "error");
    }
  };

  return { deleting, confirming, setConfirming, confirmDelete };
}
