// Keep generated message paths behind one seam so missing keys fail during compilation
// and account locale changes have one owner.

import { m } from "@/paraglide/messages.js";
import { baseLocale, getLocale, isLocale, setLocale } from "@/paraglide/runtime.js";
import type { Locale } from "@/paraglide/runtime.js";
import { enGB } from "date-fns/locale";
import type { Locale as DateFnsLocale } from "date-fns";

/** Compiled, type-checked message functions exposed through the application i18n seam. */
export { m };

const DATE_FNS_LOCALES: Record<Locale, DateFnsLocale> = {
  en: enGB,
};

/** Resolve date-fns presentation rules from the active Paraglide locale.
 * The exhaustive map makes a new generated locale require one central date-locale mapping. */
export function readActiveDateLocale(): DateFnsLocale {
  return DATE_FNS_LOCALES[getLocale()];
}

/**
 * Apply the active company's UI language to the i18n runtime.
 *
 * Reads {@link import('@capacitylens/shared/types/entities').Account.language} (the per-account language seam)
 * and switches the Paraglide runtime to it. `language` is optional/free-form on the Account, so we
 * validate it through the generated {@link isLocale} guard and fall back to {@link baseLocale} ('en')
 * for an absent or unrecognised value. A bad stored value can never throw or blank the UI here.
 *
 * `reload: false` is deliberate: the locale is account-scoped and client-only (the Vite plugin uses
 * the `globalVariable` strategy, not a cookie), so switching must not trigger a page reload, React
 * re-renders pick up the new messages on the next render. The resolve/validate path accepts any
 * compiled locale, not only English.
 *
 * @param language - The active Account's `language` field (e.g. `'en'`); `undefined` ⇒ baseLocale.
 */
export function syncLocaleFromAccount(language: string | undefined): void {
  const resolved: Locale = language !== undefined && isLocale(language) ? language : baseLocale;
  // Configured locale strategies are synchronous, so switching needs no awaited promise.
  void setLocale(resolved, { reload: false });
}
