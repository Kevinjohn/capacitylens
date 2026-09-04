import { m } from "@/i18n";
import { DEFAULT_TIME_ZONE } from "../../lib/timezones";

// Onboarding capture (P1.14): the create-company form sets language, week-start and time zone —
// the three fields the server FREEZES after creation (a later change → 409). They're captured here,
// with concrete defaults (never undefined: an unset frozen value can't be set later), and disabled
// in Settings. English-only until P1.5.1 (Paraglide), so Language is a fixed display, not a chooser.
// Company colour keeps the default preset automatically; there is no one-off colour decision in
// the onboarding path.
// Each option's `label` is a GETTER (`() => m.key()`), not a pre-resolved string — the AppShell LINKS
// pattern (P1.5.2). Resolving at import would freeze the label to the load-time locale; the getter
// defers it to render so an account/locale switch re-resolves the text (mapped at the call site).
export const WEEK_START_OPTIONS: { value: 0 | 1; label: () => string }[] = [
  { value: 1, label: () => m.picker_week_monday() },
  { value: 0, label: () => m.picker_week_sunday() },
];
export const DEFAULT_WEEK_STARTS_ON = 1 as const;
export const DEFAULT_TIMEZONE = DEFAULT_TIME_ZONE;
export const DEFAULT_LANGUAGE = "en";

/** Validate the UNTRUSTED 2xx body of POST /api/orgs — same stance as useAccountSummaries'
 *  `toSummary` (the server is external input; never trust an `as` cast). Returns null when the
 *  body is unusable (not an object, or id/name missing/empty) — the caller must then treat the
 *  create as "succeeded, but id unknown", NOT as a failure (see createOrgOnServer). */
export function toCreatedOrg(body: unknown): { id: string; name: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as { id?: unknown; name?: unknown };
  if (typeof b.id !== "string" || b.id.trim().length === 0) return null;
  if (typeof b.name !== "string" || b.name.trim().length === 0) return null;
  return { id: b.id, name: b.name };
}
