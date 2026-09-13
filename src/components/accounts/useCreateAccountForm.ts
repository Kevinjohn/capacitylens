import { m } from "@/i18n";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { accountClient, hasUnknownAccountCommandOutcome } from "../../account/accountClient";
import { transitionAccount } from "../../auth/accountTransition";
import { useAuth } from "../../auth/authContext";
import { refreshAccountSummaries } from "../../auth/useAccountSummaries";
import { isServerConfigured } from "../../data/apiConfig";
import { useFieldError } from "../../hooks/useFieldError";
import { resolveErrorMessage } from "../../lib/errorMessage";
import { DEFAULT_COLORS } from "../../lib/palette";
import { readApiError } from "../../lib/readApiError";
import {
  LIKELY_TIME_ZONES,
  listSupportedTimeZones,
  resolveBrowserTimeZone,
  resolveTimeZoneOptionLabel,
} from "../../lib/timezones";
import { validateName } from "../../lib/validation";
import { useStore } from "../../store/useStore";
import type { StoreState } from "../../store/types";

import {
  DEFAULT_LANGUAGE,
  DEFAULT_WEEK_STARTS_ON,
  parseCreatedAccount,
  WEEK_START_OPTIONS,
} from "./accountPickerDefaults";

interface CreateServerAccountInput {
  trimmedName: string;
  weekStartsOn: 0 | 1;
  timezone: string;
  refreshAuth: ReturnType<typeof useAuth>["refreshAuth"];
  resetForm: () => void;
  setSubmitting: Dispatch<SetStateAction<boolean>>;
  setNotice: StoreState["setNotice"];
  setAccountSummaries: StoreState["setAccountSummaries"];
  fail: ReturnType<typeof useFieldError>["fail"];
}

async function createServerAccount({
  trimmedName,
  weekStartsOn,
  timezone,
  refreshAuth,
  resetForm,
  setSubmitting,
  setNotice,
  setAccountSummaries,
  fail,
}: CreateServerAccountInput): Promise<void> {
  setSubmitting(true);
  try {
    const response = await accountClient.createWorkspace({
      name: trimmedName,
      color: DEFAULT_COLORS.account,
      weekStartsOn,
      timezone,
      language: DEFAULT_LANGUAGE,
      schedulingMode: "days",
      inlineActivityCreateEnabled: false,
      internalColourMode: "grey",
    });
    if (!response.ok) {
      if (hasUnknownAccountCommandOutcome(response)) {
        const list = await refreshAccountSummaries({ allowCachedFallback: false });
        await refreshAuth();
        resetForm();
        setNotice(list !== null ? m.picker_create_unknown_refreshed() : m.picker_create_unknown_stale(), "warning");
        return;
      }
      fail(null, (await readApiError(response)) ?? m.picker_err_create({ status: response.status }));
      return;
    }
    const created = parseCreatedAccount(await response.json().catch(() => null));
    if (created === null) {
      resetForm();
      await refreshAccountSummaries();
      void refreshAuth();
      return;
    }
    const summaries = useStore.getState().accountSummaries;
    if (!summaries.some((account) => account.id === created.id)) {
      setAccountSummaries([...summaries, { id: created.id, name: created.name, role: "owner" as const }]);
    }
    resetForm();
    await transitionAccount(created.id);
    void refreshAuth();
  } catch (cause) {
    const list = await refreshAccountSummaries({ allowCachedFallback: false });
    await refreshAuth();
    resetForm();
    const message = list !== null ? m.picker_create_unknown_refreshed() : m.picker_create_unknown_stale();
    setNotice(`${message} ${resolveErrorMessage(cause)}`, "warning");
  } finally {
    setSubmitting(false);
  }
}

interface CreateAccountSubmitInput extends Omit<CreateServerAccountInput, "trimmedName"> {
  name: string;
  submitting: boolean;
  clear: () => void;
  addAccount: StoreState["addAccount"];
  setActiveAccount: StoreState["setActiveAccount"];
}

function createAccountSubmit(input: CreateAccountSubmitInput): () => void {
  return () => {
    if (input.submitting) return;
    input.clear();
    const trimmedName = validateName(input.name, input.fail);
    if (!trimmedName) return;
    if (isServerConfigured()) {
      void createServerAccount({ ...input, trimmedName });
      return;
    }
    try {
      const account = input.addAccount({
        name: trimmedName,
        color: DEFAULT_COLORS.account,
        weekStartsOn: input.weekStartsOn,
        timezone: input.timezone,
        language: DEFAULT_LANGUAGE,
        schedulingMode: "days",
        inlineActivityCreateEnabled: false,
        internalColourMode: "grey",
      });
      if (account === null) return;
      input.resetForm();
      input.setActiveAccount(account.id);
    } catch (cause) {
      input.fail(null, resolveErrorMessage(cause));
    }
  };
}

function useAccountSelectOptions() {
  const timeZoneOptions = useMemo(() => {
    const supported = listSupportedTimeZones();
    const local = resolveBrowserTimeZone(supported);
    const prioritized = [local, ...LIKELY_TIME_ZONES].filter(
      (timeZone, index, values) => supported.includes(timeZone) && values.indexOf(timeZone) === index,
    );
    return [...prioritized, ...supported.filter((timeZone) => !prioritized.includes(timeZone))];
  }, []);
  // Locale-sensitive labels are safe to memoise against this module-cached frozen list while the
  // app ships one locale and this pre-account form unmounts before account-driven locale changes.
  const timeZoneSelectOptions = useMemo(
    () => timeZoneOptions.map((timeZone) => ({ value: timeZone, label: resolveTimeZoneOptionLabel(timeZone) })),
    [timeZoneOptions],
  );
  const weekStartSelectOptions = useMemo(
    () => WEEK_START_OPTIONS.map((option) => ({ value: option.value, label: option.label() })),
    [],
  );
  return { timeZoneSelectOptions, weekStartSelectOptions };
}

export function useCreateAccountForm({ refreshAuth }: { refreshAuth: ReturnType<typeof useAuth>["refreshAuth"] }) {
  const addAccount = useStore((state) => state.addAccount);
  const setAccountSummaries = useStore((state) => state.setAccountSummaries);
  const setActiveAccount = useStore((state) => state.setActiveAccount);
  const setNotice = useStore((state) => state.setNotice);
  const [creating, setCreating] = useState(false);
  // True while the server-mode create POST is in flight — guards the double-submit a slow /api/orgs
  // round-trip would otherwise allow (two companies from one form). Demo-mode create is synchronous.
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  // The three frozen-after-creation fields (P1.14), captured here with concrete defaults.
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1>(DEFAULT_WEEK_STARTS_ON);
  const [timezone, setTimezone] = useState<string>(() => resolveBrowserTimeZone());
  const { error, errorField, errorId, fail, clear } = useFieldError();
  const { timeZoneSelectOptions, weekStartSelectOptions } = useAccountSelectOptions();
  const resetForm = () => {
    clear();
    setCreating(false);
    setName("");
    setWeekStartsOn(DEFAULT_WEEK_STARTS_ON);
    setTimezone(resolveBrowserTimeZone());
  };

  const submit = createAccountSubmit({
    name,
    submitting,
    clear,
    addAccount,
    setActiveAccount,
    weekStartsOn,
    timezone,
    refreshAuth,
    resetForm,
    setSubmitting,
    setNotice,
    setAccountSummaries,
    fail,
  });

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
      timeZoneSelectOptions,
      weekStartSelectOptions,
    },
    submit,
    reset: resetForm,
  };
}
