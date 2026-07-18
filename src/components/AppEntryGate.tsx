import type { ReactNode } from 'react'
import { AccountPicker } from './accounts/AccountPicker'
import { ConnectionError } from './ConnectionError'
import { FakeSignIn } from './FakeSignIn'
import { IntroPage } from './IntroPage'
import { RotateHint } from './RotateHint'

interface AppEntryGateProps {
  hydrated: boolean
  connectionError: boolean
  loadError: boolean
  demoAuthActive: boolean
  fakeSignedIn: boolean
  hasActiveAccount: boolean
  introSeen: boolean
  onFakeSignIn: () => void
  onIntroContinue: () => void
  children: ReactNode
}

/** Expresses the mutually-exclusive app entry sequence in one ordered boundary. */
export function AppEntryGate({
  hydrated,
  connectionError,
  loadError,
  demoAuthActive,
  fakeSignedIn,
  hasActiveAccount,
  introSeen,
  onFakeSignIn,
  onIntroContinue,
  children,
}: AppEntryGateProps) {
  if (connectionError || loadError) return <ConnectionError />

  if (hydrated && demoAuthActive && !fakeSignedIn) {
    return (
      <>
        <FakeSignIn onSignIn={onFakeSignIn} />
        <RotateHint />
      </>
    )
  }

  if (hydrated && !hasActiveAccount) {
    return (
      <>
        <AccountPicker />
        <RotateHint />
      </>
    )
  }

  if (hydrated && hasActiveAccount && !introSeen) {
    return (
      <>
        <IntroPage onContinue={onIntroContinue} />
        <RotateHint />
      </>
    )
  }

  return children
}
