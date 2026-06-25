import { useEffect, useState } from 'react'
import { APP_NAME, STORAGE_KEY_PREFIX } from '@capacitylens/shared/brand'
import { Button, Modal } from './common/ui'

// One-time-per-session nudge for portrait phones: the schedule is a wide
// week-at-a-glance grid, so landscape is the orientation the app is built for.
// Session-scoped (sessionStorage, not localStorage) on purpose — a dismissed hint
// stays away for the visit but comes back next time, unlike the device-global
// display prefs. Rotating to landscape hides it; rotating back re-shows it unless
// it was dismissed.

const PORTRAIT_PHONE_QUERY = '(orientation: portrait) and (max-width: 767px)'
const DISMISS_KEY = `${STORAGE_KEY_PREFIX}rotateHintDismissed`

function isPortraitPhone(): boolean {
  try {
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia(PORTRAIT_PHONE_QUERY).matches
    }
  } catch {
    // matchMedia unavailable (jsdom) — never show
  }
  return false
}

function isDismissed(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1'
  } catch {
    return false
  }
}

export function RotateHint() {
  const [portrait, setPortrait] = useState(isPortraitPhone)
  const [dismissed, setDismissed] = useState(isDismissed)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(PORTRAIT_PHONE_QUERY)
    const onChange = (e: MediaQueryListEvent) => setPortrait(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  if (!portrait || dismissed) return null

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1')
    } catch {
      // storage blocked — the in-memory state still hides it for this mount
    }
    setDismissed(true)
  }

  return (
    <Modal
      title="Best in landscape"
      onClose={dismiss}
      onSubmit={dismiss}
      guardDirty={false}
      footer={
        <Button type="submit" onClick={dismiss}>
          Got it
        </Button>
      }
    >
      <p className="text-sm text-muted">
        {APP_NAME} is a week-at-a-glance schedule — turn your phone sideways to see the full picture.
      </p>
    </Modal>
  )
}
