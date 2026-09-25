import { describe, expect, it } from 'vitest'
import { matchOption, sameSubject, similarity } from '@/lib/optionmatch'

describe('matchOption', () => {
  const yesNo = ['Yes', 'No']

  it('matches exactly, ignoring case and punctuation', () => {
    expect(matchOption(['United States', 'Germany'], 'united states')).toBe(0)
  })

  it('maps yes/no phrasing onto whatever the form uses', () => {
    expect(matchOption(yesNo, 'true')).toBe(0)
    expect(matchOption(yesNo, 'false')).toBe(1)
    expect(matchOption(['I do', 'I do not'], 'Yes')).toBe(0)
  })

  it('reads polarity from a negated binary pair', () => {
    // The phrasing US application forms actually use.
    const pair = ['I am authorized to work in the US', 'I am not authorized to work in the US']
    expect(matchOption(pair, 'Yes')).toBe(0)
    expect(matchOption(pair, 'No')).toBe(1)

    const sponsorship = ['I will require sponsorship', "I won't require sponsorship"]
    expect(matchOption(sponsorship, 'No')).toBe(1)
  })

  it('refuses to guess polarity when neither option is negated', () => {
    expect(matchOption(['Fully remote', 'Hybrid'], 'Yes')).toBe(-1)
  })

  it('prefers an exact match over a substring one', () => {
    // "No" is a substring of "None" — exact must still win.
    expect(matchOption(['None of the above', 'No'], 'No')).toBe(1)
  })

  it('falls back to prefix matching', () => {
    expect(matchOption(['3-5 years', '6-10 years'], '3-5')).toBe(0)
  })

  it('returns -1 rather than guessing when nothing fits', () => {
    expect(matchOption(['Red', 'Green', 'Blue'], 'Kubernetes')).toBe(-1)
  })

  it('returns -1 for an empty option list or empty answer', () => {
    expect(matchOption([], 'Yes')).toBe(-1)
    expect(matchOption(yesNo, '')).toBe(-1)
  })

  it('does not match a one-character answer into an unrelated long option', () => {
    // Guards the substring tier from degenerate matches.
    expect(matchOption(['Engineering', 'Marketing'], 'g')).toBe(-1)
  })
})

describe('similarity', () => {
  it('scores identical strings as 1', () => {
    expect(similarity('years of experience', 'years of experience')).toBe(1)
  })

  it('scores unrelated strings near 0', () => {
    expect(similarity('what is your notice period', 'upload your resume')).toBeLessThan(0.4)
  })

  it('scores rewordings of the same question highly', () => {
    const score = similarity(
      'how many years of experience do you have with react',
      'how many years of experience do you have with react js',
    )
    expect(score).toBeGreaterThan(0.85)
  })

  it('handles empty input without dividing by zero', () => {
    expect(similarity('', 'anything')).toBe(0)
    expect(similarity('', '')).toBe(0)
  })

  it('scores near-identical questions about different subjects very highly', () => {
    // Documents exactly why similarity can't gate the answer bank on its own:
    // these differ by one word and score above any usable threshold.
    const score = similarity(
      'how many years of experience do you have with python',
      'how many years of experience do you have with java',
    )
    expect(score).toBeGreaterThan(0.85)
  })
})

describe('sameSubject', () => {
  it('rejects a substituted subject', () => {
    expect(
      sameSubject(
        'how many years of experience do you have with python',
        'how many years of experience do you have with java',
      ),
    ).toBe(false)
  })

  it('accepts a more fully worded version of the same question', () => {
    expect(
      sameSubject(
        'how many years of experience do you have with react',
        'how many years of experience do you have with react js',
      ),
    ).toBe(true)
  })

  it('accepts a rewording that only drops filler words', () => {
    expect(
      sameSubject('how many years of experience do you have with kubernetes', 'kubernetes experience'),
    ).toBe(true)
  })

  it('rejects two different sponsorship-adjacent questions', () => {
    expect(
      sameSubject(
        'are you legally authorized to work in the united states',
        'will you require visa sponsorship',
      ),
    ).toBe(false)
  })

  it('treats questions with no distinguishing words as the same', () => {
    expect(sameSubject('how many years of experience', 'years of experience')).toBe(true)
  })
})
