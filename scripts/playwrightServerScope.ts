/**
 * Keep report paths non-empty and reject lossy aliases instead of merging nominally distinct runs.
 * Unset or empty input returns default.
 * @throws When a non-empty name contains characters outside letters, digits, underscores and hyphens.
 */
export function parseReportPhaseName(value: string | undefined): string {
  if (!value) return 'default';
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error(
      'CAPACITYLENS_E2E_PHASE may contain only letters, numbers, underscores and hyphens.',
    );
  }
  return value;
}
