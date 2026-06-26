// i18n scaffolding tests (P1.5.1) — Paraglide (inlang) compile-time, type-safe messages.
//
// ACCEPTANCE — "a removed key fails the build": the demonstrator key `app_name` is referenced in
// type-checked code (this test + the AppShell wordmark). Deleting `app_name` from messages/en.json
// then recompiling (`npm run paraglide:compile`) removes the generated `m.app_name` function, so every
// `m.app_name()` becomes a tsc error and `npm run build`/`gate` fails. That compile-time safety is the
// whole point of choosing Paraglide; these runtime tests are the render/value smoke that rides on top.

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { baseLocale, locales } from '@/paraglide/runtime.js'
import { m } from '@/i18n'

describe('i18n scaffolding (Paraglide)', () => {
  it('compiles English as the base locale', () => {
    expect(baseLocale).toBe('en')
    expect(locales).toContain('en')
  })

  it('resolves the demonstrator message to the brand string', () => {
    // Value MUST equal APP_NAME from shared/brand so there is no brand drift / no visible change.
    expect(m.app_name()).toBe('CapacityLens')
  })

  it('renders a typed message in a component', () => {
    function Wordmark() {
      return <div>{m.app_name()}</div>
    }
    render(<Wordmark />)
    expect(screen.getByText('CapacityLens')).toBeInTheDocument()
  })
})
