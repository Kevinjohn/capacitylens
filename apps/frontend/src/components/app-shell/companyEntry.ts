import { useEffect, useRef, useState } from 'react'
import type { useNavigate } from 'react-router-dom'
import { clearJoinedCompanyHandoff, readJoinedCompanyHandoff } from '@/lib/joinedCompanyHandoff'
import { transitionCompany } from '@/auth/companyTransition'
import type { StoreState } from '@/store/types'

// Which company the shell enters at bootstrap: a joined-company handoff from the URL, or the only
// company once the directory proves there is exactly one.

interface JoinedCompanyHandoffInput {
  companySummaries: StoreState['companySummaries']
  activeCompanyId: StoreState['activeCompanyId']
  hash: string
  hydrated: boolean
  navigate: ReturnType<typeof useNavigate>
  pathname: string
  search: string
}

/** Enters the company named by a joined-company handoff once, then removes it from the URL. */
export function useJoinedCompanyHandoff(input: JoinedCompanyHandoffInput) {
  const { companySummaries, activeCompanyId, hash, hydrated, navigate, pathname, search } = input
  const [joinedCompanyHandoff] = useState(() => readJoinedCompanyHandoff(search))
  const joinedCompanyUrlCleaned = useRef(false)
  const joinedCompanyHandoffConsumed = useRef(false)
  const initialActiveCompanyId = useRef(activeCompanyId)

  useEffect(() => {
    if (!joinedCompanyHandoff || joinedCompanyUrlCleaned.current) return
    joinedCompanyUrlCleaned.current = true
    void navigate({ pathname, search: clearJoinedCompanyHandoff(search), hash }, { replace: true })
  }, [hash, joinedCompanyHandoff, navigate, pathname, search])

  useEffect(() => {
    // Wait for persistence hydration so the switch cannot race an older bootstrap replacement.
    if (!hydrated || !joinedCompanyHandoff || joinedCompanyHandoffConsumed.current) return
    const userSelectedAnotherCompany =
      activeCompanyId !== null &&
      activeCompanyId !== joinedCompanyHandoff &&
      activeCompanyId !== initialActiveCompanyId.current
    if (userSelectedAnotherCompany) {
      joinedCompanyHandoffConsumed.current = true
      return
    }
    if (!companySummaries.some((company) => company.id === joinedCompanyHandoff)) return

    joinedCompanyHandoffConsumed.current = true
    void transitionCompany(joinedCompanyHandoff)
  }, [companySummaries, activeCompanyId, hydrated, joinedCompanyHandoff])

  return joinedCompanyHandoff
}

interface SingleCompanyReloadInput {
  companySummaries: StoreState['companySummaries']
  companySummariesComplete: boolean
  activeCompanyId: StoreState['activeCompanyId']
  hydrated: boolean
}

interface ResolveSingleCompanyForReloadInput {
  companySummaries: StoreState['companySummaries']
  companySummariesComplete: boolean
  activeCompanyId: StoreState['activeCompanyId']
}

function resolveSingleCompanyForReload(input: ResolveSingleCompanyForReloadInput) {
  const company = input.companySummaries[0]
  if (
    input.activeCompanyId !== null ||
    !input.companySummariesComplete ||
    input.companySummaries.length !== 1 ||
    company?.roleStatus === 'unavailable'
  ) {
    return undefined
  }
  return company
}

/** Enters the only company after a reload when the complete directory lists exactly one. */
export function useSingleCompanyReload(input: SingleCompanyReloadInput) {
  const { companySummaries, companySummariesComplete, activeCompanyId, hydrated } = input
  const singleCompanyReloadHandled = useRef(false)

  useEffect(() => {
    if (activeCompanyId !== null) singleCompanyReloadHandled.current = false
    if (!hydrated || singleCompanyReloadHandled.current) return
    if (companySummaries.length === 0) return

    const company = resolveSingleCompanyForReload({
      companySummaries,
      companySummariesComplete,
      activeCompanyId,
    })
    if (!company) return

    singleCompanyReloadHandled.current = true
    void transitionCompany(company.id)
  }, [companySummaries, companySummariesComplete, activeCompanyId, hydrated])
}
