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

import { APP_NAME } from '@capacitylens/shared/brand'

/** The page heading. */
export const INTRO_HEADING = `Welcome to ${APP_NAME}`

/** Paragraph 1, split around the bold "resourcing tool" phrase. */
export const INTRO_PARA_1 = {
  before: `${APP_NAME} is a `,
  strong: 'resourcing tool',
  after: ' — it helps you see who\'s working on what, and who has capacity.',
} as const

/** Paragraph 2, split around the bold "not a project management tool" phrase. */
export const INTRO_PARA_2 = {
  before: `${APP_NAME} is `,
  strong: 'not a project management tool',
  after:
    '. It won\'t track tasks, tickets, or deadlines for you. It answers a simpler question: ' +
    'where are your people\'s hours going, and where is there room?',
} as const

/** Paragraph 3 — no emphasis. */
export const INTRO_PARA_3 = 'Keep it light. Plan your people, not your paperwork.'

/** The continue button's label. */
export const INTRO_CONTINUE_LABEL = 'Continue'
