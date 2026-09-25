import { describe, expect, it } from 'vitest'
import { heuristicParseResume, mergeParsedResume, preferParsed } from '@/lib/resume-heuristics'
import { defaultProfile } from '@/lib/schema'
import type { ParsedResume } from '@/lib/ai/provider'

const SAMPLE_RESUME = `Ada Lovelace
ada.lovelace@example.com
+1 (415) 555-0192
linkedin.com/in/adalovelace
github.com/adalovelace

Skills
Python, TypeScript, Distributed Systems, Kubernetes

Experience
Senior Engineer at Analytical Engines Inc
2021 - Present
Built the first general-purpose computing platform.
`

describe('heuristicParseResume', () => {
  it('extracts an email address', () => {
    expect(heuristicParseResume(SAMPLE_RESUME).email).toBe('ada.lovelace@example.com')
  })

  it('extracts and normalizes a linkedin URL', () => {
    expect(heuristicParseResume(SAMPLE_RESUME).linkedinUrl).toBe(
      'https://linkedin.com/in/adalovelace',
    )
  })

  it('extracts and normalizes a github URL', () => {
    expect(heuristicParseResume(SAMPLE_RESUME).githubUrl).toBe('https://github.com/adalovelace')
  })

  it('extracts a phone number', () => {
    expect(heuristicParseResume(SAMPLE_RESUME).phone).toContain('415')
  })

  it('guesses the candidate name from the first line', () => {
    const result = heuristicParseResume(SAMPLE_RESUME)
    expect(result.firstName).toBe('Ada')
    expect(result.lastName).toBe('Lovelace')
  })

  it('does not mistake a "Resume" or "Curriculum Vitae" header for a name', () => {
    const text = `Curriculum Vitae\nAda Lovelace\nada@example.com`
    expect(heuristicParseResume(text).firstName).toBe('Ada')
  })

  it('recovers the name from a single line packing name + contact info together', () => {
    // What a two-column header (name left, contact block right) collapses to
    // once flattened to plain text — a realistic case now that PDF line
    // reconstruction can legitimately merge same-row content onto one line.
    const text = 'Ada Lovelace | ada@example.com | +1 415 555 0192 | linkedin.com/in/ada'
    const result = heuristicParseResume(text)
    expect(result.firstName).toBe('Ada')
    expect(result.lastName).toBe('Lovelace')
  })

  it('pulls a comma-separated skills line out of a Skills section', () => {
    const result = heuristicParseResume(SAMPLE_RESUME)
    expect(result.skills).toEqual(
      expect.arrayContaining(['Python', 'TypeScript', 'Distributed Systems', 'Kubernetes']),
    )
  })

  it('never invents experience or education entries', () => {
    // These require actual segmentation, which heuristics deliberately don't attempt.
    const result = heuristicParseResume(SAMPLE_RESUME)
    expect(result.experience).toBeUndefined()
    expect(result.education).toBeUndefined()
  })

  it('returns an empty result for text with none of these signals', () => {
    const result = heuristicParseResume('Lorem ipsum dolor sit amet, consectetur adipiscing elit.')
    expect(result.email).toBeUndefined()
    expect(result.firstName).toBeUndefined()
  })

  it('does not pick up a 4-digit year or zip as a phone number', () => {
    const result = heuristicParseResume('Graduated 2019\nPostal code 94107')
    expect(result.phone).toBeUndefined()
  })
})

describe('preferParsed', () => {
  it('lets values from the second argument win over the first', () => {
    const base: ParsedResume = { firstName: 'Ada', email: 'a@example.com' }
    const better: ParsedResume = { firstName: 'Augusta' }
    expect(preferParsed(base, better)).toEqual({ firstName: 'Augusta', email: 'a@example.com' })
  })

  it('keeps the base value when the better result found nothing for that field', () => {
    const base: ParsedResume = { skills: ['Python'] }
    const better: ParsedResume = {}
    expect(preferParsed(base, better).skills).toEqual(['Python'])
  })

  it('does not let an empty array from the better result erase a real one', () => {
    const base: ParsedResume = { skills: ['Python'] }
    const better: ParsedResume = { skills: [] }
    expect(preferParsed(base, better).skills).toEqual(['Python'])
  })
})

describe('mergeParsedResume', () => {
  it('fills empty scalar fields', () => {
    const { profile, filled } = mergeParsedResume(defaultProfile(), { firstName: 'Ada' })
    expect(profile.firstName).toBe('Ada')
    expect(filled).toContain('First name')
  })

  it('never overwrites a field the user already set', () => {
    const existing = { ...defaultProfile(), firstName: 'Grace' }
    const { profile, skipped } = mergeParsedResume(existing, { firstName: 'Ada' })
    expect(profile.firstName).toBe('Grace')
    expect(skipped).toContain('First name')
  })

  it('fills years of experience only when it was still at the default of zero', () => {
    const { profile: filled } = mergeParsedResume(defaultProfile(), { yearsExperience: 8 })
    expect(filled.yearsExperience).toBe(8)

    const existing = { ...defaultProfile(), yearsExperience: 12 }
    const { profile: kept, skipped } = mergeParsedResume(existing, { yearsExperience: 8 })
    expect(kept.yearsExperience).toBe(12)
    expect(skipped).toContain('Years of experience')
  })

  it('fills the experience list wholesale, with generated ids, when it was empty', () => {
    const { profile } = mergeParsedResume(defaultProfile(), {
      experience: [
        {
          company: 'Analytical Engines Inc',
          title: 'Senior Engineer',
          location: '',
          startDate: '2021',
          endDate: '',
          current: true,
          description: '',
        },
      ],
    })

    expect(profile.experience).toHaveLength(1)
    expect(profile.experience[0]?.company).toBe('Analytical Engines Inc')
    expect(profile.experience[0]?.id).toBeTruthy()
  })

  it('does not touch existing experience entries', () => {
    const existing = {
      ...defaultProfile(),
      experience: [
        {
          id: 'e1',
          company: 'Existing Co',
          title: 'Engineer',
          location: '',
          startDate: '',
          endDate: '',
          current: false,
          description: '',
        },
      ],
    }

    const { profile, skipped } = mergeParsedResume(existing, {
      experience: [
        {
          company: 'Parsed Co',
          title: 'Engineer',
          location: '',
          startDate: '',
          endDate: '',
          current: false,
          description: '',
        },
      ],
    })

    expect(profile.experience).toHaveLength(1)
    expect(profile.experience[0]?.company).toBe('Existing Co')
    expect(skipped).toContain('Work experience')
  })

  it('leaves both lists empty and reports nothing when the parse found nothing', () => {
    const { profile, filled, skipped } = mergeParsedResume(defaultProfile(), {})
    expect(profile).toEqual(defaultProfile())
    expect(filled).toHaveLength(0)
    expect(skipped).toHaveLength(0)
  })
})
