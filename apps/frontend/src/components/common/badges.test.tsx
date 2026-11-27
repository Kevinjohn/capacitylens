import { loadPlanningData } from '@/test/fixtures'
import { describe, it, expect, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { ColorSwatch } from './ui'
import { useStore } from '@/store/useStore'
import { createEmptyAppData } from '@capacitylens/shared/types/entities'

beforeEach(() => {
  loadPlanningData(createEmptyAppData())
  useStore.getState().clearFilters()
  useStore.getState().setDirtyForm(false)
})

describe('ColorSwatch', () => {
  it('renders a span with the given background color', () => {
    const { container } = render(<ColorSwatch color="#ec4899" />)
    const swatch = container.firstChild as HTMLElement
    expect(swatch).toBeInTheDocument()
    expect(swatch.style.backgroundColor).toBe('rgb(236, 72, 153)')
  })
})
