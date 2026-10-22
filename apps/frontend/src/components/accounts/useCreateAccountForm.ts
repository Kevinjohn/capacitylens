import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useFieldError } from "@/hooks/useFieldError";
import { isDemoMode } from "@/data/apiConfig";
import { resolveErrorMessage } from "@/lib/errorMessage";
import { DEFAULT_COLORS } from "@/lib/palette";
import {
  LIKELY_TIME_ZONES,
  listSupportedTimeZones,
  resolveBrowserTimeZone,
  resolveTimeZoneOptionLabel,
} from "@/lib/timezones";
import { parseName } from "@/lib/validation";
import { useStore } from "@/store/useStore";
import { DEFAULT_LANGUAGE, DEFAULT_WEEK_STARTS_ON, WEEK_START_OPTIONS } from "./accountPickerDefaults";

function useAccountSelectOptions() {
  const timeZoneOptions = useMemo(() => {
    const supported = listSupportedTimeZones();
    const local = resolveBrowserTimeZone(supported);
    const prioritized = [local, ...LIKELY_TIME_ZONES].filter(
      (timeZone, index, values) => supported.includes(timeZone) && values.indexOf(timeZone) === index,
    );
    return [...prioritized, ...supported.filter((timeZone) => !prioritized.includes(timeZone))];
  }, []);
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

function resetCreateAccountForm(form: {
  clear: () => void;
  setCreating: Dispatch<SetStateAction<boolean>>;
  setName: Dispatch<SetStateAction<string>>;
  setWeekStartsOn: Dispatch<SetStateAction<0 | 1>>;
  setTimezone: Dispatch<SetStateAction<string>>;
}) {
  form.clear();
  form.setCreating(false);
  form.setName("");
  form.setWeekStartsOn(DEFAULT_WEEK_STARTS_ON);
  form.setTimezone(resolveBrowserTimeZone());
}

/** Tracks creation fields for the editable, page-memory demo. */
export function useCreateAccountForm() {
  const addAccount = useStore((state) => state.addAccount);
  const setActiveAccount = useStore((state) => state.setActiveAccount);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1>(DEFAULT_WEEK_STARTS_ON);
  const [timezone, setTimezone] = useState<string>(() => resolveBrowserTimeZone());
  const { error, errorField, errorId, fail, clear } = useFieldError();
  const { timeZoneSelectOptions, weekStartSelectOptions } = useAccountSelectOptions();
  const resetForm = () => resetCreateAccountForm({ clear, setCreating, setName, setWeekStartsOn, setTimezone });
  const submit = () => {
    if (!isDemoMode()) return;
    clear();
    const trimmedName = parseName(name, fail);
    if (!trimmedName) return;
    try {
      const account = addAccount({
        name: trimmedName,
        color: DEFAULT_COLORS.account,
        weekStartsOn,
        timezone,
        language: DEFAULT_LANGUAGE,
        schedulingMode: "days",
        inlineActivityCreateEnabled: false,
      });
      if (account === null) return;
      resetForm();
      setActiveAccount(account.id);
    } catch (cause) {
      fail(null, resolveErrorMessage(cause));
    }
  };
  return {
    form: {
      creating,
      setCreating,
      name,
      language: DEFAULT_LANGUAGE,
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
