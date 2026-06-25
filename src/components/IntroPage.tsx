import { Button } from './common/ui'
import {
  INTRO_CONTINUE_LABEL,
  INTRO_HEADING,
  INTRO_PARA_1,
  INTRO_PARA_2,
  INTRO_PARA_3,
} from '../lib/introCopy'

// Post-login "What CapacityLens is" intermediary page. A minimal full-screen gate shown once per device
// (the `capacitylens/introSeen` flag) after the viewer lands on a company, before the app proper —
// explaining CapacityLens is a resourcing tool, not a project-management tool. Mirrors the FakeSignIn /
// LoginScreen card styling (centred card on the canvas). The wording is PLACEHOLDER COPY single-
// sourced in `lib/introCopy.ts` (pending human edit); the two bold phrases are wrapped in <strong>
// here in JSX, never via dangerouslySetInnerHTML and with no markdown library.

/**
 * The post-login intro gate.
 *
 * @param onContinue called when the viewer dismisses the intro (clicks Continue) — the host
 *   (AppShell) flips the device-global `introSeen` flag and reveals the app.
 */
export function IntroPage({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <div className="rounded-lg border border-line bg-surface p-6 shadow-sm">
          <h1 className="mb-3 text-xl font-semibold text-ink">{INTRO_HEADING}</h1>
          <p className="mb-3 text-sm text-muted">
            {INTRO_PARA_1.before}
            <strong className="font-semibold text-ink">{INTRO_PARA_1.strong}</strong>
            {INTRO_PARA_1.after}
          </p>
          <p className="mb-3 text-sm text-muted">
            {INTRO_PARA_2.before}
            <strong className="font-semibold text-ink">{INTRO_PARA_2.strong}</strong>
            {INTRO_PARA_2.after}
          </p>
          <p className="mb-5 text-sm text-muted">{INTRO_PARA_3}</p>
          <div className="flex justify-end">
            <Button onClick={onContinue} testId="intro-continue">
              {INTRO_CONTINUE_LABEL}
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}
