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
})
