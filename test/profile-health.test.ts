import { describe, expect, it } from 'vitest'
import { assessProfile } from '@/lib/profile-health'
import { defaultProfile, type Profile } from '@/lib/schema'

/**
 * Profile readiness exists to fix the *cause* of a disappointing autofill
 * rather than its symptom: nearly every blank field traces back to the
 * profile not having the answer. So the ranking is by how often a real form
 * asks for something, not by how hard it is to fill in — which is why a
 * missing email has to outrank a missing portfolio link.
 */

function profileWith(patch: Partial<Profile> = {}): Profile {
  return { ...defaultProfile(), ...patch }
}

const COMPLETE: Partial<Profile> = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: '7700900123',
  city: 'Paris',
  country: 'France',
  headline: 'Backend engineer',
  summary: 'Ten years of backend work.',
  linkedinUrl: 'https://linkedin.com/in/ada',
  skills: ['Python', 'Kubernetes', 'PostgreSQL'],
  experience: [
    {
      id: 'a',
      company: 'Acme',
      title: 'Engineer',
      location: '',
      startDate: '2019',
      endDate: '',
      current: true,
      description: '',
    },
  ],
  education: [
    { id: 'e', school: 'MIT', degree: 'BSc', field: 'CS', startYear: '', endYear: '', grade: '' },
  ],
  resume: {
    fileName: 'cv.pdf',
    mimeType: 'application/pdf',
    dataBase64: 'aGk=',
    text: 'Ada Lovelace, engineer.',
    sizeBytes: 2,
    updatedAt: 0,
  },
}

describe('assessProfile', () => {
  it('scores an empty profile at zero and refuses to call it ready', () => {
    const health = assessProfile(defaultProfile())

    expect(health.score).toBe(0)
    expect(health.ready).toBe(false)
    expect(health.gaps.length).toBeGreaterThan(5)
  })

  it('scores a complete profile at 100 with nothing outstanding', () => {
    const health = assessProfile(profileWith(COMPLETE))

    expect(health.score).toBe(100)
    expect(health.ready).toBe(true)
    expect(health.gaps).toEqual([])
  })

  it('treats a name and an email as the bar for being usable at all', () => {
    const health = assessProfile(profileWith({ firstName: 'Ada', email: 'ada@example.com' }))

    // Far from complete, but enough to attempt a form.
    expect(health.ready).toBe(true)
    expect(health.score).toBeLessThan(50)
  })

  it('is not ready on a name alone', () => {
    expect(assessProfile(profileWith({ firstName: 'Ada' })).ready).toBe(false)
  })

  it('ranks the gaps by what they actually cost', () => {
    const gaps = assessProfile(defaultProfile()).gaps

    // Email is asked for on every form; a portfolio link on few. Showing them
    // the other way round would send someone to fix the wrong thing first.
    const email = gaps.findIndex((gap) => gap.id === 'email')
    const links = gaps.findIndex((gap) => gap.id === 'links')

    expect(email).toBeGreaterThanOrEqual(0)
    expect(email).toBeLessThan(links)
  })

  it('explains what each gap costs rather than just naming it', () => {
    const gap = assessProfile(defaultProfile()).gaps.find((entry) => entry.id === 'email')

    expect(gap?.impact.length).toBeGreaterThan(20)
    expect(gap?.section).toBe('profile')
  })

  it('points work history gaps at the Experience tab', () => {
    const gaps = assessProfile(defaultProfile()).gaps
    expect(gaps.find((gap) => gap.id === 'experience')?.section).toBe('history')
    expect(gaps.find((gap) => gap.id === 'education')?.section).toBe('history')
  })

  it('wants more than a token skill or two', () => {
    const thin = assessProfile(profileWith({ ...COMPLETE, skills: ['Python'] }))
    expect(thin.gaps.some((gap) => gap.id === 'skills')).toBe(true)
  })

  it('counts a CV only when text was actually extracted from it', () => {
    const unreadable = assessProfile(
      profileWith({
        ...COMPLETE,
        resume: {
          fileName: 'scan.pdf',
          mimeType: 'application/pdf',
          dataBase64: 'aGk=',
          // A scanned PDF with no text layer: stored, but useless downstream.
          text: '',
          sizeBytes: 2,
          updatedAt: 0,
        },
      }),
    )

    expect(unreadable.gaps.some((gap) => gap.id === 'resume')).toBe(true)
  })

  it('accepts any one of the profile links', () => {
    const withGithub = assessProfile(
      profileWith({ ...COMPLETE, linkedinUrl: '', githubUrl: 'https://github.com/ada' }),
    )
    expect(withGithub.gaps.some((gap) => gap.id === 'links')).toBe(false)
  })

  it('never reports a score outside 0–100', () => {
    for (const profile of [defaultProfile(), profileWith(COMPLETE)]) {
      const { score } = assessProfile(profile)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    }
  })
})
