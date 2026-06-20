import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IntroPage } from './IntroPage'

// Match a <p> by its FULL text (across the nested <strong>). Testing Library's default getByText
// skips elements that have element children, so a paragraph wrapping a <strong> needs an explicit
// matcher on the whole textContent — which is exactly what we want to pin (copy + emphasis position).
function paragraphWithText(text: string) {
  return screen.getByText((_content, el) => el?.tagName === 'P' && el.textContent === text)
}

// This test is the VERBATIM-COPY GUARD for the post-login intro page. The wording is placeholder
// copy single-sourced in `lib/introCopy.ts` (a human edits it later) — pin the EXACT strings here so
// an accidental paraphrase fails the gate. The two emphasised phrases must render inside <strong>
// without altering the surrounding text (assembled in JSX, no markdown library). The em-dash "—" and
// the STRAIGHT ASCII apostrophes "'" (byte-verbatim from floaty-copy.md, NOT curly) are part of the
// copy and are asserted as-is.

describe('IntroPage (post-login "What Floaty is")', () => {
  it('renders the heading, three verbatim paragraphs, the two bold phrases, and Continue', () => {
    render(<IntroPage onContinue={() => {}} />)

    // Exactly one h1, with the verbatim heading.
    const headings = screen.getAllByRole('heading', { level: 1 })
    expect(headings).toHaveLength(1)
    expect(headings[0]).toHaveTextContent('Welcome to Floaty')

    // Paragraph 1 — verbatim, including the bold span as part of the sentence.
    expect(
      paragraphWithText(
        'Floaty is a resourcing tool — it helps you see who\'s working on what, and who has capacity.',
      ),
    ).toBeInTheDocument()

    // Paragraph 2 — verbatim. "tasks" here is generic English (NOT the renamed Activity concept).
    expect(
      paragraphWithText(
        'Floaty is not a project management tool. It won\'t track tasks, tickets, or deadlines for ' +
          'you. It answers a simpler question: where are your people\'s hours going, and where is ' +
          'there room?',
      ),
    ).toBeInTheDocument()

    // Paragraph 3 — verbatim, no emphasis.
    expect(
      paragraphWithText('Keep it light. Plan your people, not your paperwork.'),
    ).toBeInTheDocument()

    // The two emphasised phrases render inside <strong>.
    const resourcing = screen.getByText('resourcing tool')
    expect(resourcing.tagName).toBe('STRONG')
    const notPm = screen.getByText('not a project management tool')
    expect(notPm.tagName).toBe('STRONG')

    // The Continue button.
    expect(screen.getByRole('button', { name: 'Continue' })).toBeInTheDocument()
    expect(screen.getByTestId('intro-continue')).toBeInTheDocument()
  })

  it('clicking Continue calls onContinue', async () => {
    const user = userEvent.setup()
    const onContinue = vi.fn()
    render(<IntroPage onContinue={onContinue} />)
    await user.click(screen.getByRole('button', { name: 'Continue' }))
    expect(onContinue).toHaveBeenCalledOnce()
  })
})
