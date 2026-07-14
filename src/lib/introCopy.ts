// PLACEHOLDER COPY — pending human edit. From floaty-copy.md (the source doc keeps its filename);
// do NOT rewrite/invent positioning. A human edits this wording before launch; the post-login
// IntroPage is the only consumer. Mirrors the single-source pattern of `externalCopy.ts` so the copy
// lives in one place. The brand name reads through APP_NAME (single source — shared/src/brand.ts);
// everything else stays verbatim.
//
// Each paragraph is split into FRAGMENTS so the two bold phrases can be wrapped in <strong> in JSX
// WITHOUT altering the surrounding text — we assemble the emphasis in JSX (no markdown library, no
// dangerouslySetInnerHTML). Verbatim (apart from the brand name) means byte-for-byte: the copy uses
// STRAIGHT ASCII apostrophes (0x27) in "who's", "won't", "people's" — keep them straight, not curly.
// Preserve the em-dash "—" exactly as below.
// NOTE: "tasks" in para 2 is generic English ("track tasks, tickets, or deadlines"), NOT the renamed
// Activity domain concept — keep it verbatim.
//
// i18n (P1.5.2): the copy now resolves through Paraglide messages (`@/i18n`). Each export is a GETTER
// (`() => …`), not a pre-resolved constant — the AppShell LINKS pattern — so the text re-resolves at
// render with the active account's locale rather than freezing to the import-time locale. The brand
// name flows in as the `{app}` placeholder (still single-sourced via APP_NAME).

import { APP_NAME } from '@capacitylens/shared/brand'
import { m } from '@/i18n'

/** The page heading. */
export const introHeading = () => m.intro_welcome({ app: APP_NAME })

/** Paragraph 1, split around the bold "resourcing tool" phrase. */
export const introPara1 = () => ({
  before: m.intro_p1_before({ app: APP_NAME }),
  strong: m.intro_p1_strong(),
  after: m.intro_p1_after(),
})

/** Paragraph 2, split around the bold "not a project management tool" phrase. */
export const introPara2 = () => ({
  before: m.intro_p2_before({ app: APP_NAME }),
  strong: m.intro_p2_strong(),
  after: m.intro_p2_after(),
})

/** Paragraph 3 — no emphasis. */
export const introPara3 = () => m.intro_p3()

/** The continue button's label. */
export const introContinueLabel = () => m.intro_continue()
