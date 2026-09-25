import { describe, expect, it } from 'vitest'
import { renderResume, resumeToText } from '@/lib/tailored-resume'
import { defaultProfile, type Profile, type TailoredResume } from '@/lib/schema'

/**
 * The tailored resume's one real safety property: the model writes wording,
 * never facts. Companies, titles and dates are reattached here from the
 * stored profile, so a rewrite that hallucinated an employer still can't put
 * one on the page — and a role the rewrite skipped entirely must not vanish
 * off the candidate's own resume either.
 */

function profileWith(): Profile {
  return {
    ...defaultProfile(),
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phone: '+1 415 555 0134',
    city: 'London',
    skills: ['Python', 'Kubernetes', 'PostgreSQL'],
    experience: [
      {
        id: 'a',
        company: 'Acme',
        title: 'Senior Engineer',
        location: 'London',
        startDate: '2019',
        endDate: '',
        current: true,
        description: 'Built things at Acme.',
      },
      {
        id: 'b',
        company: 'Widgets Inc',
        title: 'Engineer',
        location: 'Leeds',
        startDate: '2016',
        endDate: '2019',
        current: false,
        description: 'Built other things.',
      },
    ],
    education: [
      {
        id: 'e',
        school: 'MIT',
        degree: 'BSc',
        field: 'Computer Science',
        startYear: '2012',
        endYear: '2016',
        grade: '',
      },
    ],
  }
}

const TAILORED: TailoredResume = {
  summary: 'Backend engineer with production Kubernetes experience.',
  skills: ['Kubernetes', 'Python', 'PostgreSQL'],
  roles: [{ index: 0, bullets: ['Ran Kubernetes in production.', 'Cut deploy time in half.'] }],
  notes: ['No Terraform anywhere in your history — left it out.'],
  generatedAt: 0,
}

describe('renderResume', () => {
  it('takes company, title and dates from the profile, never from the rewrite', () => {
    const rendered = renderResume(profileWith(), TAILORED)

    expect(rendered.roles[0]?.company).toBe('Acme')
    expect(rendered.roles[0]?.title).toBe('Senior Engineer')
    // "current: true" is what makes this Present, not anything generated.
    expect(rendered.roles[0]?.dates).toBe('2019 – Present')
    expect(rendered.roles[1]?.dates).toBe('2016 – 2019')
  })

  it('uses the rewritten bullets for the role they were written for', () => {
    const rendered = renderResume(profileWith(), TAILORED)
    expect(rendered.roles[0]?.bullets).toEqual([
      'Ran Kubernetes in production.',
      'Cut deploy time in half.',
    ])
  })

  it('keeps a role the rewrite skipped, falling back to what the candidate wrote', () => {
    // Dropping it would quietly delete a job from their own resume.
    const rendered = renderResume(profileWith(), TAILORED)
    expect(rendered.roles).toHaveLength(2)
    expect(rendered.roles[1]?.bullets).toEqual(['Built other things.'])
  })

  it('carries the reordered skills through', () => {
    const rendered = renderResume(profileWith(), TAILORED)
    expect(rendered.skills).toEqual(['Kubernetes', 'Python', 'PostgreSQL'])
  })

  it('falls back to the profile skills when the rewrite listed none', () => {
    const rendered = renderResume(profileWith(), { ...TAILORED, skills: [] })
    expect(rendered.skills).toEqual(['Python', 'Kubernetes', 'PostgreSQL'])
  })

  it('formats education from the profile', () => {
    const rendered = renderResume(profileWith(), TAILORED)
    expect(rendered.education[0]).toBe('BSc in Computer Science — MIT (2016)')
  })

  it('keeps the notes, which are the part that says what it could not claim', () => {
    const rendered = renderResume(profileWith(), TAILORED)
    expect(rendered.notes).toHaveLength(1)
  })
})

describe('resumeToText', () => {
  it('lays the resume out as pasteable text', () => {
    const text = resumeToText(renderResume(profileWith(), TAILORED))

    expect(text).toContain('Ada Lovelace')
    expect(text).toContain('ada@example.com | +1 415 555 0134 | London')
    expect(text).toContain('SUMMARY')
    expect(text).toContain('Senior Engineer — Acme (London | 2019 – Present)')
    expect(text).toContain('- Ran Kubernetes in production.')
    expect(text).toContain('EDUCATION')
  })

  it('leaves the notes out — they are for the candidate, not the employer', () => {
    const text = resumeToText(renderResume(profileWith(), TAILORED))
    expect(text).not.toContain('No Terraform')
  })

  it('does not emit empty sections for a bare profile', () => {
    const text = resumeToText(
      renderResume(defaultProfile(), { summary: '', skills: [], roles: [], notes: [], generatedAt: 0 }),
    )

    expect(text).not.toContain('SUMMARY')
    expect(text).not.toContain('EXPERIENCE')
    expect(text).not.toContain('SKILLS')
  })
})
