/**
 * Server reply messages that the browser client matches by exact text.
 *
 * @remarks These strings are a wire contract between `server/` and `src/`. The client compares
 * them with `===`, so rewording, re-casing or punctuating one silently changes client
 * behaviour without failing a type check. Never edit a value here; when a response needs a new
 * distinction, add a machine-readable `code` field to its body instead. Every other server
 * message lives in `server/src/routes/replyErrors.ts` and may be reworded freely.
 */
export const FROZEN_REPLY_MESSAGES = {
  /**
   * 404 body for a missing row, and for a row concealed from a non-member. The lifecycle archive
   * sync (`src/data/sync/lifecycleOps.ts`) treats a 404 carrying exactly this text as "already
   * gone" rather than as a failure.
   */
  notFound: "Not found",
} as const;
