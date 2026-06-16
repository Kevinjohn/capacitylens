import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DateHeader } from './DateHeader'
import { buildColumnGeometry } from './columnGeometry'

const DAYS = ['2026-06-01', '2026-06-02', '2026-06-06']
const DEFAULT_PROPS = { weekStartsOn: 1 as 0 | 1, today: '2026-06-01' }

// Uniform geometry (minimise off): widths are all `dayWidth`, so weekend labels still read
// "Sat". The narrow-weekend / "S"-label behaviour is exercised separately (commit 2).
const renderHeader = (dayWidth: number) =>
  render(
    <DateHeader
      days={DAYS}
      dayWidth={dayWidth}
      geom={buildColumnGeometry(DAYS, dayWidth, { minimiseWeekends: false, weekendWidth: 22 })}
      {...DEFAULT_PROPS}
    />,
  )

describe('DateHeader', () => {
  it('always shows the month tier', () => {
    renderHeader(48)
    expect(screen.getByText('Jun 2026')).toBeInTheDocument()
  })

  describe('at a coarse zoom (dayWidth < 18)', () => {
    it('shows week-start labels instead of day numbers', () => {
      renderHeader(12)
      expect(screen.getByText('1 Jun')).toBeInTheDocument()
      expect(screen.queryByText('2')).not.toBeInTheDocument()
    })
  })

  describe('with dayWidth={48} (>= 36)', () => {
    it('shows day numbers 1, 2, and 6', () => {
      renderHeader(48)
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('6')).toBeInTheDocument()
    })

    it('shows weekday abbreviations for each day', () => {
      renderHeader(48)
      // 2026-06-01 is a Monday → Mon
      expect(screen.getByText('Mon')).toBeInTheDocument()
      // 2026-06-02 is a Tuesday → Tue
      expect(screen.getByText('Tue')).toBeInTheDocument()
      // 2026-06-06 is a Saturday → Sat
      expect(screen.getByText('Sat')).toBeInTheDocument()
    })
  })

  describe('with dayWidth={20} (< 36)', () => {
    it('still shows day numbers 1, 2, and 6', () => {
      renderHeader(20)
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('6')).toBeInTheDocument()
    })

    it('does NOT show weekday abbreviations', () => {
      renderHeader(20)
      expect(screen.queryByText('Mon')).not.toBeInTheDocument()
      expect(screen.queryByText('Tue')).not.toBeInTheDocument()
      expect(screen.queryByText('Sat')).not.toBeInTheDocument()
    })
  })

  describe('with minimise weekends ON (narrowed weekend columns)', () => {
    // Fri, Sat, Sun, Mon — a window straddling a full weekend.
    const WEEKEND_DAYS = ['2026-06-05', '2026-06-06', '2026-06-07', '2026-06-08']
    const renderMinimised = (dayWidth: number) =>
      render(
        <DateHeader
          days={WEEKEND_DAYS}
          dayWidth={dayWidth}
          geom={buildColumnGeometry(WEEKEND_DAYS, dayWidth, { minimiseWeekends: true, weekendWidth: 22 })}
          weekStartsOn={1}
          today="2026-06-05"
        />,
      )

    it('shows "S" for BOTH Saturday and Sunday, and keeps the weekday letters either side', () => {
      renderMinimised(48)
      expect(screen.getByText('Fri')).toBeInTheDocument()
      expect(screen.getByText('Mon')).toBeInTheDocument()
      expect(screen.getAllByText('S')).toHaveLength(2) // Sat + Sun both collapse to "S"
      expect(screen.queryByText('Sat')).not.toBeInTheDocument()
      expect(screen.queryByText('Sun')).not.toBeInTheDocument()
    })

    it('still shows the date number in each narrowed weekend column', () => {
      renderMinimised(48)
      expect(screen.getByText('6')).toBeInTheDocument() // Sat 06-06
      expect(screen.getByText('7')).toBeInTheDocument() // Sun 06-07
    })

    it('renders weekend cells at the narrow width and weekdays at dayWidth', () => {
      const { container } = renderMinimised(48)
      const cells = container.querySelectorAll('.flex.flex-auto > div')
      // Fri(48), Sat(22), Sun(22), Mon(48) — widths come straight from the geometry.
      expect(Array.from(cells).map((c) => (c as HTMLElement).style.width)).toEqual(['48px', '22px', '22px', '48px'])
    })
  })
})
