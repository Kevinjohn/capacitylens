import { describe, expect, it } from 'vitest'
import { cleanText, hasDisallowedChars, MAX_NAME_LENGTH } from './strings'

// Built from numeric code points so the source file stays pure ASCII (no invisible
// or ambiguous literals that would make the test lie about what it checks).
const PARTY = String.fromCodePoint(0x1f389) // party popper emoji
const POO = String.fromCodePoint(0x1f4a9) // pile of poo emoji
const CHECK = String.fromCodePoint(0x2705) // white check mark emoji
const NUL = String.fromCodePoint(0x0000) // control char
const ZWJ = String.fromCodePoint(0x200d) // zero-width joiner (format)
const RLO = String.fromCodePoint(0x202e) // right-to-left override (format)

describe('hasDisallowedChars', () => {
  it('accepts ordinary names incl. accents, CJK and punctuation', () => {
    for (const ok of ['José Müller', "O'Brien & Co", 'Acme, Inc.', '设计部', 'Project Lightning 2']) {
      expect(hasDisallowedChars(ok)).toBe(false)
    }
  })

  it('rejects emoji / pictographs', () => {
    expect(hasDisallowedChars(`Acme ${PARTY} Co`)).toBe(true)
    expect(hasDisallowedChars(POO)).toBe(true)
    expect(hasDisallowedChars(`done ${CHECK}`)).toBe(true)
  })

  it('rejects flag emoji (regional indicators) and symbol marks', () => {
    const FLAG_GB = String.fromCodePoint(0x1f1ec, 0x1f1e7) // 🇬🇧
    expect(hasDisallowedChars(`from ${FLAG_GB}`)).toBe(true)
    expect(hasDisallowedChars(`Acme${String.fromCodePoint(0x2122)}`)).toBe(true) // trademark sign
  })

  it('rejects control and zero-width / format characters', () => {
    expect(hasDisallowedChars(`a${NUL}b`)).toBe(true)
    expect(hasDisallowedChars(`a${ZWJ}b`)).toBe(true)
    expect(hasDisallowedChars(`a${RLO}b`)).toBe(true)
  })

  it('rejects a newline in single-line mode but allows it in multiline', () => {
    expect(hasDisallowedChars('line1\nline2')).toBe(true)
    expect(hasDisallowedChars('line1\nline2', { multiline: true })).toBe(false)
    expect(hasDisallowedChars(`still ${PARTY} bad`, { multiline: true })).toBe(true)
  })
})

describe('cleanText', () => {
  it('strips emoji and collapses whitespace', () => {
    expect(cleanText(`Acme  ${PARTY}  Co`)).toBe('Acme Co')
    expect(cleanText(PARTY)).toBe('')
  })

  it('keeps accented letters untouched', () => {
    expect(cleanText('José Müller')).toBe('José Müller')
  })

  it('keeps newlines only in multiline mode', () => {
    expect(cleanText('a\nb')).toBe('a b')
    expect(cleanText('a\nb', { multiline: true })).toBe('a\nb')
  })

  it('caps length to the max', () => {
    const long = 'a'.repeat(MAX_NAME_LENGTH + 50)
    expect(cleanText(long).length).toBe(MAX_NAME_LENGTH)
  })
})
