import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DateHeader } from './DateHeader'

const DAYS = ['2026-06-01', '2026-06-02', '2026-06-06']

describe('DateHeader', () => {
  describe('with dayWidth={48} (>= 36)', () => {
    it('shows day numbers 1, 2, and 6', () => {
      render(<DateHeader days={DAYS} dayWidth={48} />)
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('6')).toBeInTheDocument()
    })

    it('shows weekday abbreviations for each day', () => {
      render(<DateHeader days={DAYS} dayWidth={48} />)
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
      render(<DateHeader days={DAYS} dayWidth={20} />)
      expect(screen.getByText('1')).toBeInTheDocument()
      expect(screen.getByText('2')).toBeInTheDocument()
      expect(screen.getByText('6')).toBeInTheDocument()
    })

    it('does NOT show weekday abbreviations', () => {
      render(<DateHeader days={DAYS} dayWidth={20} />)
      expect(screen.queryByText('Mon')).not.toBeInTheDocument()
      expect(screen.queryByText('Tue')).not.toBeInTheDocument()
      expect(screen.queryByText('Sat')).not.toBeInTheDocument()
    })
  })
})
