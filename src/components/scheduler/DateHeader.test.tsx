import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DateHeader } from './DateHeader'

const DAYS = ['2026-06-01', '2026-06-02', '2026-06-06']
const DEFAULT_PROPS = { weekStartsOn: 1 as 0 | 1, today: '2026-06-01' }

describe('DateHeader', () => {
  it('always shows the month tier', () => {
    render(<DateHeader days={DAYS} dayWidth={48} {...DEFAULT_PROPS} />)
    expect(screen.getByText('Jun 2026')).toBeInTheDocument()
  })

  describe('at a coarse zoom (dayWidth < 18)', () => {
    it('shows week-start labels instead of day numbers', () => {
      render(<DateHeader days={DAYS} dayWidth={12} {...DEFAULT_PROPS} />)
      expect(screen.getByText('1 Jun')).toBeInTheDocument()
      expect(screen.queryByText('2')).not.toBeInTheDocument()
    })
  })

  describe('with dayWidth={48} (>= 36)', () => {
    it('shows day numbers 1, 2, and 6', () => {
      render(<DateHeader days={DAYS} dayWidth={48} {...DEFAULT_PROPS} />)
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('6')).toBeInTheDocument()
    })

    it('shows weekday abbreviations for each day', () => {
      render(<DateHeader days={DAYS} dayWidth={48} {...DEFAULT_PROPS} />)
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
      render(<DateHeader days={DAYS} dayWidth={20} {...DEFAULT_PROPS} />)
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('6')).toBeInTheDocument()
    })

    it('does NOT show weekday abbreviations', () => {
      render(<DateHeader days={DAYS} dayWidth={20} {...DEFAULT_PROPS} />)
      expect(screen.queryByText('Mon')).not.toBeInTheDocument()
      expect(screen.queryByText('Tue')).not.toBeInTheDocument()
      expect(screen.queryByText('Sat')).not.toBeInTheDocument()
    })
  })
})
