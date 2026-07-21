import { Button } from './common/ui'
import {
  introContinueLabel,
  introHeading,
  introPara1,
  introPara2,
  introPara3,
} from '../lib/introCopy'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card'

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
  // Copy resolves at render via the introCopy getters (Paraglide-backed) so the active locale applies.
  const para1 = introPara1()
  const para2 = introPara2()
  return (
    <div className="flex min-h-full items-center justify-center bg-canvas p-6">
      <main className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle><h1>{introHeading()}</h1></CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            {para1.before}
            <strong className="font-semibold text-ink">{para1.strong}</strong>
            {para1.after}
          </p>
          <p className="text-sm text-muted">
            {para2.before}
            <strong className="font-semibold text-ink">{para2.strong}</strong>
            {para2.after}
          </p>
          <p className="text-sm text-muted">{introPara3()}</p>
          </CardContent>
          <CardFooter className="justify-end">
            <Button onClick={onContinue} testId="intro-continue">
              {introContinueLabel()}
            </Button>
          </CardFooter>
        </Card>
      </main>
    </div>
  )
}
