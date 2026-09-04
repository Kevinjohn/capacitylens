import { m } from "@/i18n";
import { useState } from "react";
import { accountClient, accountCommandOutcomeWasUnknown } from "../../account/accountClient";
import { useAuth } from "../../auth/authContext";
import { refreshAccountSummaries } from "../../auth/useAccountSummaries";
import { isServerConfigured } from "../../data/apiConfig";
import { errorMessage } from "../../lib/errorMessage";
import { readApiError } from "../../lib/readApiError";
import type { AccountSummary } from "../../store/useStore";
import { useStore } from "../../store/useStore";

export function useDeleteAccount({ refreshAuth }: { refreshAuth: ReturnType<typeof useAuth>["refreshAuth"] }) {
  const deleteAccount = useStore((s) => s.deleteAccount);
  const setAccountSummaries = useStore((s) => s.setAccountSummaries);
  const setNotice = useStore((s) => s.setNotice);
  // True while the server-mode DELETE is in flight — passed to the dialog as `busy` so the armed
  // Delete button disarms during the round-trip. Without it a double-click sends an overlapping
  // command that may still be in progress and raises a spurious retry error after a successful
  // delete. Demo-mode delete is synchronous and never sets it.
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState<AccountSummary | null>(null);
  // SERVER-mode delete calls the dedicated DELETE route (gated 'purge' — admin+ — server-side; it
  // erases the whole tenant transactionally). The store's local deleteAccount can NOT do this job in
  // server mode: persistence diffs AppData snapshots, and in server mode `data` holds only the loaded
  // slice — "deleting" a company whose slice isn't loaded would diff to zero ops, delete nothing, and
  // the company would resurrect on the next summaries refetch. `data` is deliberately NOT mutated
  // here: the picker only renders with no active account, so a stale (now-deleted) slice in `data` is
  // invisible and gets replaced wholesale by the next account pick's loadAll.
  const deleteOrgOnServer = async (id: string) => {
    // In-flight guard, self-contained (the dialog's `busy` disable is the visible half): a second
    // overlapping DELETE can race the first command — see the `deleting` state's comment.
    if (deleting) return;
    setDeleting(true);
    try {
      // The account client applies the bulk timeout because whole-tenant erasure can legitimately
      // outlive the interactive request bound while its transaction completes.
      const res = await accountClient.eraseWorkspace(id);
      if (!res.ok) {
        if (accountCommandOutcomeWasUnknown(res)) {
          const fresh = await refreshAccountSummaries({ allowCachedFallback: false });
          await refreshAuth();
          setNotice(fresh !== null ? m.picker_delete_unknown_refreshed() : m.picker_delete_unknown_stale(), "warning");
          return;
        }
        setNotice((await readApiError(res)) ?? m.picker_err_delete({ status: res.status }), "error");
        return;
      }
      const summaries = useStore.getState().accountSummaries;
      const removedName = summaries.find((summary) => summary.id === id)?.name;
      setAccountSummaries(summaries.filter((s) => s.id !== id));
      if (removedName) setNotice(m.picker_delete_success({ name: removedName }), "info");
      // The delete flipped the facts /me computes: on a single-company instance, dropping the only
      // company back to zero accounts makes canCreateAccount true again (the bootstrap exemption).
      // Without this re-ask the picker would show the "ask an admin for an invite" empty state with
      // NO "New company" button — a dead end until a manual reload. refreshAuth is TOTAL (an
      // unresolved refresh keeps the stale value with a warn; the server 403 backstops), so
      // fire-and-forget is safe.
      void refreshAuth();
    } catch (e) {
      // A timeout/abort says only that the BROWSER stopped waiting — the transactional erasure may
      // already have COMMITTED server-side. Asserting "nothing was removed" here would leave a
      // now-deleted company in the picker (re-clicking it 403s) until a manual reload. Reconcile
      // instead: re-read the authoritative /api/accounts list and adopt it (the company drops out
      // if the erase committed; a failed re-read leaves the list untouched, same as before).
      const fresh = await refreshAccountSummaries({ allowCachedFallback: false });
      await refreshAuth();
      setNotice(
        fresh !== null
          ? `${m.picker_delete_unknown_refreshed()} ${errorMessage(e)}`
          : `${m.picker_delete_unknown_stale()} ${errorMessage(e)}`,
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
    // DEMO build: the local cascade drops the account and all its scoped data irreversibly.
    try {
      const removedName = useStore.getState().data.accounts.find((account) => account.id === id)?.name;
      deleteAccount(id);
      if (removedName) setNotice(m.picker_delete_success({ name: removedName }), "info");
      setConfirming(null);
    } catch (error) {
      setNotice(errorMessage(error), "error");
    }
  };

  return { deleting, confirming, setConfirming, confirmDelete };
}
