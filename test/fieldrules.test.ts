import { describe, expect, it } from 'vitest'
import { classifySignals, normalizeQuestion, valueForKey } from '@/lib/fieldrules'
import { defaultProfile } from '@/lib/schema'

/**
 * Classification is the highest-leverage thing to get right: a misclassified
 * field means the wrong value goes into a real application. The cases here are
 * the ones that a naive keyword match gets wrong.
 */

describe('classifySignals', () => {
  it('prefers the specific name fields over the generic one', () => {
    expect(classifySignals({ label: 'First name', kind: 'text' }).key).toBe('firstName')
    expect(classifySignals({ label: 'Last name', kind: 'text' }).key).toBe('lastName')
    expect(classifySignals({ label: 'Full name', kind: 'text' }).key).toBe('fullName')
  })

  it('does not mistake a company or school name field for the candidate name', () => {
    expect(classifySignals({ label: 'Company name', kind: 'text' }).key).not.toBe('fullName')
    expect(classifySignals({ label: 'School name', kind: 'text' }).key).toBe('school')
  })

  it('treats the autocomplete attribute as near-certain', () => {
    const result = classifySignals({
      label: 'Contact', // useless label
      autocomplete: 'given-name',
      kind: 'text',
    })
    expect(result.key).toBe('firstName')
    expect(result.confidence).toBeGreaterThan(0.95)
  })

  it('reads camelCase and snake_case attribute names', () => {
    expect(classifySignals({ label: '', attributes: 'firstName', kind: 'text' }).key).toBe(
      'firstName',
    )
    expect(classifySignals({ label: '', attributes: 'postal_code', kind: 'text' }).key).toBe(
      'postalCode',
    )
  })

  it('scores a label match above an attribute-only match', () => {
    const byLabel = classifySignals({ label: 'Email', kind: 'email' })
    const byAttr = classifySignals({ label: '', attributes: 'email', kind: 'email' })
    expect(byLabel.confidence).toBeGreaterThan(byAttr.confidence)
  })

  it('excludes confirmation fields from the email slot', () => {
    expect(classifySignals({ label: 'Confirm email', kind: 'email' }).key).not.toBe('email')
  })

  it('separates sponsorship from work authorization', () => {
    expect(
      classifySignals({
        label: 'Will you now or in the future require visa sponsorship?',
        kind: 'radio',
      }).key,
    ).toBe('requiresSponsorship')

    expect(
      classifySignals({
        label: 'Are you legally authorized to work in the United States?',
        kind: 'radio',
      }).key,
    ).toBe('workAuthorized')
  })

  it('does not let "United States" in a question hijack the state field', () => {
    expect(
      classifySignals({
        label: 'Are you legally authorized to work in the United States?',
        kind: 'radio',
      }).key,
    ).not.toBe('state')
  })

  it('only maps a resume slot onto a file input', () => {
    expect(classifySignals({ label: 'Resume', kind: 'file' }).key).toBe('resume')
    // A "resume" textarea is something else — a summary, usually.
    expect(classifySignals({ label: 'Resume', kind: 'textarea' }).key).not.toBe('resume')
  })

  it('maps only a real letter field onto the cover letter slot', () => {
    for (const label of ['Cover letter', 'Motivation letter', 'Letter of interest']) {
      expect(classifySignals({ label, kind: 'textarea' }).key).toBe('coverLetter')
    }

    // A short-answer question, not a letter. Routed to the cover letter slot
    // it would be answered with 400 words and a sign-off.
    expect(
      classifySignals({ label: 'Why are you interested in this role?', kind: 'textarea' }).key,
    ).not.toBe('coverLetter')
  })

  it('recognises years-of-experience phrasings', () => {
    for (const label of [
      'Years of experience',
      'How many years of professional experience do you have?',
      'Years experience',
    ]) {
      expect(classifySignals({ label, kind: 'number' }).key).toBe('yearsExperience')
    }
  })

  it('returns no key for a genuinely novel question', () => {
    const result = classifySignals({
      label: 'Describe a time you disagreed with your manager.',
      kind: 'textarea',
    })
    expect(result.key).toBeNull()
    expect(result.confidence).toBe(0)
  })
})

describe('normalizeQuestion', () => {
  it('collapses punctuation and case so rewordings collide', () => {
    expect(normalizeQuestion('How many years  of EXPERIENCE?')).toBe('how many years of experience')
  })

  it('keeps apostrophes so contractions stay distinct', () => {
    expect(normalizeQuestion("Don't you agree?")).toBe("don't you agree")
  })
})

describe('valueForKey', () => {
  it('renders booleans as Yes/No for option matching', () => {
    const profile = { ...defaultProfile(), workAuthorized: true, requiresSponsorship: false }
    expect(valueForKey('workAuthorized', profile)).toBe('Yes')
    expect(valueForKey('requiresSponsorship', profile)).toBe('No')
  })

  it('describes an immediate start rather than saying "0 weeks"', () => {
    const profile = { ...defaultProfile(), noticePeriodWeeks: 0 }
    expect(valueForKey('noticePeriod', profile)).toBe('Immediately')
  })

  it('returns null for empty profile slots instead of an empty string', () => {
    expect(valueForKey('email', defaultProfile())).toBeNull()
  })

  it('never returns a string for the resume slot', () => {
    expect(valueForKey('resume', defaultProfile())).toBeNull()
  })
})
