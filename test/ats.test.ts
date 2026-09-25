import { describe, expect, it } from 'vitest'
import { extractJobKeywords, requiredYears, scoreResumeAgainstJob } from '@/lib/ats'
import { defaultProfile, type Profile } from '@/lib/schema'

/**
 * The ATS score is the one number in this extension a user might act on —
 * rewriting their CV because of it — so the things worth pinning down are the
 * ways a keyword matcher goes quietly wrong: boilerplate scoring as signal
 * ("experience", "team", "5+"), a term matching inside a longer word (java
 * inside javascript), and one idea counted twice because a sliding window cut
 * two overlapping phrases out of it.
 */

const JOB = `Senior Backend Engineer

We are looking for a Senior Backend Engineer to join our platform team.

Requirements:
- 5+ years of experience building production services in Python
- Strong knowledge of PostgreSQL and Redis
- Experience with Kubernetes and Docker in production
- Familiarity with event-driven architecture and Kafka`

const RESUME = `Ada Lovelace
ada@example.com | +1 415 555 0134

Experience
Senior Backend Engineer, Acme Corp (2019 - present)
Built production Python services on Kubernetes, backed by PostgreSQL.
Designed an event-driven ingestion pipeline on Kafka.

Education
BSc Computer Science, MIT

Skills
Python, PostgreSQL, Kubernetes, Docker, Kafka`

function profileWith(patch: Partial<Profile> = {}): Profile {
  return { ...defaultProfile(), ...patch }
}

function terms(jobDescription: string): string[] {
  return extractJobKeywords(jobDescription).map((keyword) => keyword.term)
}

describe('extractJobKeywords', () => {
  it('keeps the concrete skills and drops posting boilerplate', () => {
    const found = terms(JOB)

    expect(found).toContain('python')
    expect(found).toContain('postgresql')
    expect(found).toContain('kubernetes')
    expect(found).toContain('kafka')

    // Every posting ever written contains these. Matching on them would score
    // every resume as a near-perfect fit for every job.
    for (const boilerplate of ['experience', 'requirements', 'team', 'strong', 'years', 'we']) {
      expect(found).not.toContain(boilerplate)
    }
  })

  it('keeps technology names that are mostly punctuation', () => {
    const found = terms('- Deep knowledge of C++, C# and Node.js required')
    expect(found).toContain('c++')
    expect(found).toContain('c#')
    expect(found).toContain('node.js')
  })

  it('does not treat a bare figure as a skill', () => {
    // "5+" survives a digits-only filter because of the plus sign.
    expect(terms('- 5+ years of Python')).not.toContain('5+')
  })

  it('keeps comma-separated skills separate rather than gluing them into a phrase', () => {
    const found = terms('- Experience with Python, Terraform, Kafka')

    expect(found).toContain('python')
    expect(found).toContain('terraform')
    expect(found).toContain('kafka')
    expect(found).not.toContain('python terraform')
    expect(found).not.toContain('terraform kafka')
  })

  it('captures a recurring two-word phrase, which is what a recruiter searches for', () => {
    const found = terms('- Build machine learning models\n- Own the machine learning roadmap')
    expect(found).toContain('machine learning')
  })

  it('ignores a two-word pairing the posting only made once', () => {
    // "build machine" is a window artefact, not a term — and keeping it would
    // suppress "machine", which is the word that carries the meaning.
    const found = terms('- Build machine learning models daily')
    expect(found).not.toContain('build machine')
    expect(found).toContain('machine')
    expect(found).toContain('learning')
  })

  it('drops a word that only ever appears inside a phrase it kept', () => {
    const found = terms('- Build machine learning models\n- Improve machine learning quality')

    expect(found).toContain('machine learning')
    expect(found).not.toContain('machine')
    expect(found).not.toContain('learning')
  })

  it('keeps a word that also stands on its own outside the phrase', () => {
    const found = terms(
      '- Own our machine learning platform\n- Ship machine learning features\n- Tune each model and its learning rate',
    )

    expect(found).toContain('machine learning')
    expect(found).toContain('learning')
  })

  it('keeps only one phrase out of an overlapping run of words', () => {
    // A sliding window over "event-driven architecture" yields both
    // "event driven" and "driven architecture" — one idea, counted twice.
    const found = terms(
      '- Design event-driven architecture\n- Maintain our event-driven architecture',
    ).filter((term) => term.includes(' '))

    expect(found).toContain('event driven')
    expect(found).not.toContain('driven architecture')
  })

  it('ranks a term from a requirements line above a passing mention', () => {
    const found = terms('We have a lovely office in Berlin with terraform somewhere.\n- Must have strong postgres')
    expect(found.indexOf('postgres')).toBeLessThan(found.indexOf('terraform'))
  })

  it('returns nothing for an empty posting', () => {
    expect(extractJobKeywords('')).toEqual([])
  })
})

describe('requiredYears', () => {
  it('reads a "5+ years" requirement', () => {
    expect(requiredYears('We need 5+ years of experience.')).toBe(5)
  })

  it('takes the upper bound of a range', () => {
    expect(requiredYears('3-5 years of relevant experience')).toBe(5)
  })

  it('takes the highest credible bar when several are stated', () => {
    expect(requiredYears('8+ years overall, including 3 years with Python')).toBe(8)
  })

  it('ignores a figure too large to be a requirement', () => {
    // A company blurb, not a screen.
    expect(requiredYears('Serving customers for over 30 years.')).toBeNull()
  })

  it('returns null when the posting never says', () => {
    expect(requiredYears('We want a great engineer who ships.')).toBeNull()
  })
})

describe('scoreResumeAgainstJob', () => {
  const profile = profileWith({ yearsExperience: 6, currentTitle: 'Senior Backend Engineer' })

  const strong = () =>
    scoreResumeAgainstJob({
      resumeText: RESUME,
      profile,
      jobTitle: 'Senior Backend Engineer',
      jobDescription: JOB,
    })

  it('scores a matching resume far above an unrelated one', () => {
    const unrelated = scoreResumeAgainstJob({
      resumeText: 'Jane Doe\nPastry chef, ten years in fine dining.\njane@example.com',
      profile: profileWith({ yearsExperience: 1, currentTitle: 'Pastry Chef' }),
      jobTitle: 'Senior Backend Engineer',
      jobDescription: JOB,
    })

    expect(strong().score).toBeGreaterThan(65)
    expect(unrelated.score).toBeLessThan(25)
  })

  it('lists a posting term the resume never uses as missing, not matched', () => {
    const result = strong()

    // The posting asks for Redis; this resume has never mentioned it.
    expect(result.missing).toContain('redis')
    expect(result.matched).not.toContain('redis')
    expect(result.matched).toContain('kubernetes')
  })

  it('does not match a term inside a longer word', () => {
    const result = scoreResumeAgainstJob({
      resumeText: 'Ten years of JavaScript and nothing else whatsoever.',
      profile: profileWith(),
      jobTitle: '',
      jobDescription: '- Must have deep Java expertise',
    })

    expect(result.missing).toContain('java')
    expect(result.matched).not.toContain('java')
  })

  it('counts skills from the profile, not just the uploaded resume text', () => {
    const withoutResume = scoreResumeAgainstJob({
      resumeText: '',
      profile: profileWith({ skills: ['Kubernetes', 'Kafka', 'PostgreSQL', 'Python'] }),
      jobTitle: '',
      jobDescription: JOB,
    })

    expect(withoutResume.matched).toContain('kubernetes')
    expect(withoutResume.matched).toContain('kafka')
  })

  it('skips the title component when no job title is given', () => {
    const ids = scoreResumeAgainstJob({
      resumeText: RESUME,
      profile,
      jobTitle: '',
      jobDescription: JOB,
    }).components.map((component) => component.id)

    expect(ids).not.toContain('title')
    expect(ids).toContain('keywords')
  })

  it('skips the experience component when the posting states no requirement', () => {
    const ids = scoreResumeAgainstJob({
      resumeText: RESUME,
      profile,
      jobTitle: 'Backend Engineer',
      jobDescription: '- Write Python\n- Deploy to Kubernetes',
    }).components.map((component) => component.id)

    expect(ids).not.toContain('experience')
  })

  it('gives full marks for experience once the profile clears the bar', () => {
    const component = strong().components.find((entry) => entry.id === 'experience')
    expect(component?.score).toBe(1)
  })

  it('scores experience proportionally when the profile falls short', () => {
    const result = scoreResumeAgainstJob({
      resumeText: RESUME,
      profile: profileWith({ yearsExperience: 1 }),
      jobTitle: '',
      jobDescription: JOB,
    })

    const component = result.components.find((entry) => entry.id === 'experience')
    expect(component?.score).toBeCloseTo(0.2)
    expect(result.notes.join(' ')).toContain('5 years')
  })

  it('flags a resume a parser would struggle with', () => {
    const result = scoreResumeAgainstJob({
      resumeText: 'Ada Lovelace. Engineer.',
      profile: profileWith(),
      jobTitle: '',
      jobDescription: JOB,
    })

    const parseability = result.components.find((entry) => entry.id === 'parseability')
    expect(parseability?.score).toBeLessThan(0.5)
    expect(result.notes.join(' ')).toContain('email')
  })

  it('never reports a score outside 0–100, even with nothing to go on', () => {
    const empty = scoreResumeAgainstJob({
      resumeText: '',
      profile: profileWith(),
      jobTitle: '',
      jobDescription: '',
    })

    expect(empty.score).toBeGreaterThanOrEqual(0)
    expect(empty.score).toBeLessThanOrEqual(100)
    expect(empty.matched).toEqual([])
  })

  it('gives the same answer twice for the same input', () => {
    expect(strong()).toEqual(strong())
  })
})
