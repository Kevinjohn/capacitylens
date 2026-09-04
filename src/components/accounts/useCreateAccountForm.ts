import { m } from "@/i18n";
import { useMemo, useState } from "react";
import { accountClient, accountCommandOutcomeWasUnknown } from "../../account/accountClient";
import { transitionAccount } from "../../auth/accountTransition";
import { useAuth } from "../../auth/authContext";
import { refreshAccountSummaries } from "../../auth/useAccountSummaries";
import { isServerConfigured } from "../../data/apiConfig";
import { useFieldError } from "../../hooks/useFieldError";
import { errorMessage } from "../../lib/errorMessage";
import { DEFAULT_COLORS } from "../../lib/palette";
import { readApiError } from "../../lib/readApiError";
import { supportedTimeZones, timeZoneOptionLabel } from "../../lib/timezones";
import { validateName } from "../../lib/validation";
import { useStore } from "../../store/useStore";

import {
  DEFAULT_LANGUAGE,
  DEFAULT_TIMEZONE,
  DEFAULT_WEEK_STARTS_ON,
  toCreatedOrg,
  WEEK_START_OPTIONS,
} from "./accountPickerDefaults";
export function useCreateAccountForm({ refreshAuth }: { refreshAuth: ReturnType<typeof useAuth>["refreshAuth"] }) {
  const addAccount = useStore((s) => s.addAccount);
  const setAccountSummaries = useStore((s) => s.setAccountSummaries);
  const setActiveAccount = useStore((s) => s.setActiveAccount);
  const setNotice = useStore((s) => s.setNotice);
  const [creating, setCreating] = useState(false);
  // True while the server-mode create POST is in flight — guards the double-submit a slow /api/orgs
  // round-trip would otherwise allow (two companies from one form). Demo-mode create is synchronous.
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  // The three frozen-after-creation fields (P1.14), captured here with concrete defaults.
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1>(DEFAULT_WEEK_STARTS_ON);
  const [timezone, setTimezone] = useState<string>(DEFAULT_TIMEZONE);
  const { error, errorField, errorId, fail, clear } = useFieldError();
  const tzOptions = supportedTimeZones();
  // Locale-sensitive labels (Paraglide m.*() / Intl), so a stale memo would silently keep a prior
  // locale's text on screen. Currently safe to key on the stable inputs alone: the app ships one
  // locale (project.inlang/settings.json: locales: ["en"]), and this create-company form only
  // renders before an active account exists — the one place `syncLocaleFromAccount` can change the
  // locale (useAppShellController, keyed off the ACTIVE account's language) fires after an account is
  // picked, by which point this form has unmounted. tzOptions is the module-cached frozen array from
  // supportedTimeZones() (stable reference across renders), so this only recomputes when it changes.
  const tzSelectOptions = useMemo(
    () => tzOptions.map((tz) => ({ value: tz, label: timeZoneOptionLabel(tz) })),
    [tzOptions],
  );
  const weekStartSelectOptions = useMemo(
    () => WEEK_START_OPTIONS.map((o) => ({ value: o.value, label: o.label() })),
    [],
  );

  const resetForm = () => {
    clear();
    setCreating(false);
    setName("");
    setWeekStartsOn(DEFAULT_WEEK_STARTS_ON);
    setTimezone(DEFAULT_TIMEZONE);
  };

  // SERVER-mode create goes through POST /api/orgs — the ATOMIC account + built-in Internal client +
  // caller-as-Owner membership path — NOT the local addAccount + snapshot-diff sync. The generic
  // batch path can only write the bare account row: in auth-on mode the batch's scoped Internal-client
  // op 403s (the creator has no membership yet), so the company would appear to be created, raise a
  // persistence error, and vanish on reload — and no membership would ever exist server-side (the
  // P1.13 client migration the server's /api/orgs comment was waiting on). The three frozen fields
  // ride in the body; the server sanitizes/validates them exactly like the generic account write.
  const createOrgOnServer = async (trimmed: string) => {
    setSubmitting(true);
    try {
      const res = await accountClient.createWorkspace({
        name: trimmed,
        color: DEFAULT_COLORS.account,
        weekStartsOn,
        timezone,
        language: DEFAULT_LANGUAGE,
        internalColourMode: "grey",
      });
      if (!res.ok) {
        if (accountCommandOutcomeWasUnknown(res)) {
          // A response can fail after the command commits (proxy timeout, worker restart, or a
          // still-running ledger entry). Close the form and reconcile before allowing a retry.
          const list = await refreshAccountSummaries({ allowCachedFallback: false });
          await refreshAuth();
          resetForm();
          setNotice(list !== null ? m.picker_create_unknown_refreshed() : m.picker_create_unknown_stale(), "warning");
          return;
        }
        // The server's message (single-company cap / org-create gate) is the useful one; the
        // status-stamped fallback covers an unreadable body.
        fail(null, (await readApiError(res)) ?? m.picker_err_create({ status: res.status }));
        return;
      }
      // A 2xx means the org EXISTS server-side no matter what the body looks like, so the body
      // read must NOT be allowed to throw into the transport catch below — that would surface an
      // error over a create that SUCCEEDED and leave the form open for a resubmit (a duplicate
      // company, or a spurious single-company-cap 403). Parse best-effort, validate the shape.
      const created = toCreatedOrg(await res.json().catch(() => null));
      if (created === null) {
        // DELIBERATE ASYMMETRY with the !res.ok branch: this is a SUCCESS with an unusable body,
        // not a failure. We can't seed a summary or activate (no trustworthy id — a bogus one
        // would slip past setActiveAccount's validation and load a nameless shell), so close the
        // form (resubmit = duplicate) and refetch the authoritative list instead: the new company
        // appears in the picker and the user opens it from there. A null refetch leaves the list
        // as-is — AppShell's own summaries fetch backstops on the next mount.
        resetForm();
        await refreshAccountSummaries();
        // The create changed the facts /me computes (account count, the caller's owner standing) —
        // re-ask so canCreateAccount tracks it (e.g. the button hides once a capped instance fills
        // up). refreshAuth is TOTAL (never rejects — degrades to the stale snapshot with a warn),
        // so fire-and-forget is safe.
        void refreshAuth();
        return;
      }
      // Seed the summary BEFORE activating: setActiveAccount validates ids against
      // data.accounts ∪ accountSummaries, and the just-created org is in neither yet.
      // Append-if-absent so a concurrent summaries refetch can't duplicate it.
      const summaries = useStore.getState().accountSummaries;
      if (!summaries.some((a) => a.id === created.id)) {
        setAccountSummaries([...summaries, { id: created.id, name: created.name, role: "owner" as const }]);
      }
      resetForm();
      await transitionAccount(created.id);
      // Same re-ask as the unusable-body branch above: the create moved the server-side facts
      // behind canCreateAccount. Total, so fire-and-forget is safe.
      void refreshAuth();
    } catch (e) {
      // Once dispatched, a transport rejection cannot tell us whether the atomic create committed.
      // Reconcile first and close the form so an immediate retry cannot mint a duplicate company.
      const list = await refreshAccountSummaries({ allowCachedFallback: false });
      await refreshAuth();
      resetForm();
      setNotice(
        list !== null
          ? `${m.picker_create_unknown_refreshed()} ${errorMessage(e)}`
          : `${m.picker_create_unknown_stale()} ${errorMessage(e)}`,
        "warning",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const submit = () => {
    // In-flight guard, self-contained (not just the button's `disabled` attribute): a POST already
    // in flight means any further submit — however triggered — must be a no-op, or one form could
    // create two companies.
    if (submitting) return;
    clear();
    const trimmed = validateName(name, fail);
    if (!trimmed) return;
    // Pass the three frozen fields as CONCRETE values (never undefined): the server freezes them after
    // creation, so an unset value here could never be set later — stranding the user (P1.14, TRAP 4).
    if (isServerConfigured()) {
      void createOrgOnServer(trimmed);
      return;
    }
    // DEMO build: local store create. A viewer refusal is a notice-backed no-op; other store-side
    // validation errors surface in the form rather than becoming uncaught React errors. addAccount
    // is the one CRUD action that works with no active account, bootstrapping the first tenant.
    try {
      const account = addAccount({
        name: trimmed,
        color: DEFAULT_COLORS.account,
        weekStartsOn,
        timezone,
        language: DEFAULT_LANGUAGE,
        internalColourMode: "grey",
      });
      if (account === null) return;
      resetForm();
      setActiveAccount(account.id);
    } catch (e) {
      fail(null, errorMessage(e));
    }
  };

  return {
    form: {
      creating,
      setCreating,
      submitting,
      name,
      setName,
      weekStartsOn,
      setWeekStartsOn,
      timezone,
      setTimezone,
      error,
      errorField,
      errorId,
      clear,
      tzSelectOptions,
      weekStartSelectOptions,
    },
    submit,
    reset: resetForm,
  };
}
