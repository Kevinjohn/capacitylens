// Explainer copy for the External / 3rd-party feature, shared by the Resources-tab section and the
// Settings → External section so the two never drift. Describes what External IS and IS NOT.
//
// EDITABLE COPY: this wording is product copy, not behaviour — refine it in messages/<locale>.json
// (key `external_explainer`). It lives in one place on purpose; both surfaces call this getter.
//
// i18n: the copy resolves through Paraglide (`@/i18n`). This is a GETTER (`() => …`), not a
// pre-resolved constant — mirrors `introCopy.ts` — so the text re-resolves at render with the active
// account's locale rather than freezing to the import-time locale.
import { m } from '@/i18n'

/** The shared External / 3rd-party explainer paragraph (Resources tab + Settings → External). */
export const externalExplainer = () => m.external_explainer()
