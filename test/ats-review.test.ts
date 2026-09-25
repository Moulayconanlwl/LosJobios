import { describe, expect, it } from 'vitest'
import { scoreResumeAgainstJob, stem } from '@/lib/ats'
import { defaultProfile, type Profile } from '@/lib/schema'

/**
 * The review half of the ATS scorer: matching the way a real tracker does,
 * and turning the result into advice someone can act on.
 *
 * Two failure modes are worth more than any number here. The first is a
 * *false miss* — the posting says "Kubernetes", the resume says "K8s", and
 * the advice that follows is to add something that is already there. The
 * second is advice that can't be acted on: telling someone to acquire a skill
 * when what they actually need to do is mention it.
 */

const JOB = `Senior Backend Engineer

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

function score(patch: {
  resumeText?: string
  profile?: Profile
  jobTitle?: string
  jobDescription?: string
}) {
  return scoreResumeAgainstJob({
    resumeText: patch.resumeText ?? RESUME,
    profile: patch.profile ?? profileWith(),
    jobTitle: patch.jobTitle ?? '',
    jobDescription: patch.jobDescription ?? JOB,
  })
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

describe('stem', () => {
  it('collapses the tense and plural forms of one word', () => {
    const family = ['manage', 'managed', 'manages', 'managing', 'manager', 'management']
    expect(new Set(family.map(stem)).size).toBe(1)
  })

  it('leaves short whole terms alone', () => {
    // "Go" the language must never be reduced toward "going", and "Java"
    // must never be reduced at all.
    expect(stem('go')).toBe('go')
    expect(stem('java')).toBe('java')
    expect(stem('data')).toBe('data')
    expect(stem('aws')).toBe('aws')
  })

  it('keeps genuinely different words apart', () => {
    expect(stem('scala')).not.toBe(stem('scale'))
    expect(stem('java')).not.toBe(stem('javascript'))
    expect(stem('go')).not.toBe(stem('going'))
  })
})

describe('acronym and synonym equivalence', () => {
  it('matches an acronym in the resume against the full term in the posting', () => {
    expect(
      score({ resumeText: 'Ran K8s clusters in production.', jobDescription: '- Strong Kubernetes experience' })
        .matched,
    ).toContain('kubernetes')
  })

  it('matches the full term in the resume against an acronym in the posting', () => {
    expect(
      score({ resumeText: 'Deep JavaScript experience.', jobDescription: '- Must have strong JS skills' }).matched,
    ).toContain('js')
  })

  it('matches a multi-word term against its acronym', () => {
    expect(
      score({ resumeText: 'Six years of machine learning work.', jobDescription: '- Background in ML required' })
        .matched,
    ).toContain('ml')
  })

  it('still refuses to match a term inside a longer word', () => {
    // The guarantee the old padded-haystack trick provided has to survive the
    // move to a token index.
    const result = score({
      resumeText: 'Ten years of JavaScript.',
      jobDescription: '- Must have deep Java expertise',
    })

    expect(result.missing).toContain('java')
    expect(result.matched).not.toContain('java')
  })
})

describe('matching across tense', () => {
  it('counts "managed" against a posting that says "managing"', () => {
    expect(
      score({ resumeText: 'Managed a platform team of nine.', jobDescription: '- Managing a backend team' }).matched,
    ).toContain('managing')
  })

  it('does not let a verb swallow a short language name', () => {
    expect(
      score({ resumeText: 'I enjoy going to conferences about Rust.', jobDescription: '- Must know Go' }).matched,
    ).not.toContain('go')
  })
})

// ---------------------------------------------------------------------------
// Advice
// ---------------------------------------------------------------------------

describe('easy wins', () => {
  it('separates "your profile says it, your document does not" from a real gap', () => {
    /*
     * The tracker parses the uploaded document, not this extension's profile.
     * A term the profile claims and the document omits is a real loss — but
     * one that nothing has to *become true* to fix, which is the opposite of
     * a skills gap and must never be listed alongside one.
     */
    const result = score({
      resumeText:
        'Ada Lovelace\nada@example.com\n+1 415 555 0134\nExperience\n2019 - present\nSkills\nWrote Python.',
      profile: profileWith({ skills: ['Kubernetes', 'Python'] }),
    })

    expect(result.easyWins).toContain('kubernetes')
    expect(result.easyWins).not.toContain('python') // the document already says it
    expect(result.missing).toContain('redis') // nothing claims this anywhere
    expect(result.easyWins).not.toContain('redis')
  })

  it('is empty when the document already says everything the profile does', () => {
    expect(score({}).easyWins).toEqual([])
  })
})

describe('stated requirements', () => {
  const frenchJob = `${JOB}\n- Fluent French is required for this role`

  it('flags a stated requirement nothing in the application evidences', () => {
    const result = score({ jobDescription: frenchJob })

    expect(result.components.map((c) => c.id)).toContain('requirements')
    expect(result.suggestions.map((s) => s.id)).toContain('requirement-french')
  })

  it('counts a language listed on the profile as evidence', () => {
    const result = score({
      jobDescription: frenchJob,
      profile: profileWith({ languages: ['French (native)', 'English'] }),
    })

    expect(result.suggestions.map((s) => s.id)).not.toContain('requirement-french')
    expect(result.components.find((c) => c.id === 'requirements')?.score).toBe(1)
  })

  it('does not invent a requirement the posting never states', () => {
    // A posting that merely uses a word is not a posting that demands it —
    // otherwise every ad written in France would "require French" of everyone.
    const result = score({ jobDescription: 'We are a French company building developer tools.' })

    expect(result.components.map((c) => c.id)).not.toContain('requirements')
  })

  it('treats an education entry as evidence of a stated degree requirement', () => {
    const result = score({
      resumeText: 'Ada Lovelace\nada@example.com\nExperience\nSkills\n2019 - present',
      profile: profileWith({
        education: [
          {
            id: 'edu-1',
            school: 'MIT',
            degree: 'BSc',
            field: 'Computer Science',
            startYear: '2015',
            endYear: '2019',
            grade: '',
          },
        ],
      }),
      jobDescription: "- Bachelor's degree required",
    })

    expect(result.suggestions.map((s) => s.id)).not.toContain('requirement-degree')
  })
})

describe('seniority', () => {
  it('reports a gap that keyword overlap is blind to', () => {
    // "Junior Developer" and "Senior Developer" share every meaningful word,
    // so the keyword and title components both look healthy.
    const result = score({
      profile: profileWith({ currentTitle: 'Junior Developer' }),
      jobTitle: 'Senior Developer',
    })

    expect(result.suggestions.map((s) => s.id)).toContain('seniority-below')
  })

  it('mentions reading as overqualified, at a lower severity', () => {
    const result = score({
      profile: profileWith({ currentTitle: 'Head of Engineering' }),
      jobTitle: 'Junior Developer',
    })

    expect(result.suggestions.find((s) => s.id === 'seniority-above')?.severity).toBe('polish')
  })

  it('says nothing when either side is silent about level', () => {
    /*
     * Inferring seniority from silence is how you tell someone they are too
     * junior for a job whose title simply didn't say.
     */
    const silentPosting = score({
      profile: profileWith({ currentTitle: 'Junior Developer' }),
      jobTitle: 'Developer',
    })
    const silentProfile = score({
      profile: profileWith({ currentTitle: 'Developer' }),
      jobTitle: 'Senior Developer',
    })

    for (const result of [silentPosting, silentProfile]) {
      expect(result.suggestions.map((s) => s.id).join(' ')).not.toContain('seniority')
    }
  })
})

describe('machine readability', () => {
  function checkIds(resumeText: string): string[] {
    return score({ resumeText }).suggestions.map((s) => s.id)
  }

  it('notices a resume with no dates on it', () => {
    // Trackers compute years of experience from the dates beside each role,
    // so a resume with none reports zero years however long you have worked.
    expect(
      checkIds('Ada Lovelace\nada@example.com\n+1 415 555 0134\nExperience\nSkills\nBuilt things.'),
    ).toContain('no-dates')
  })

  it('notices a resume that extracts as one unbroken block', () => {
    // The signature of a two-column or table layout: the extractor got one
    // run of text, and so will the tracker.
    const blob = `Ada Lovelace ada@example.com +1 415 555 0134 Experience Skills 2019 ${'Built production services. '.repeat(30)}`

    expect(checkIds(blob)).toContain('single-blob')
  })

  it('notices a damaged PDF text layer', () => {
    expect(checkIds(`${RESUME}\n${'�'.repeat(40)}`)).toContain('extraction-noise')
  })

  it('passes a clean resume on every one of them', () => {
    const ids = checkIds(RESUME)

    for (const id of ['no-dates', 'single-blob', 'extraction-noise', 'no-email', 'no-phone']) {
      expect(ids, id).not.toContain(id)
    }
  })
})

describe('suggestions', () => {
  const weak = () =>
    score({
      resumeText: 'Ada Lovelace. Engineer.',
      profile: profileWith({ yearsExperience: 1, currentTitle: 'Junior Developer' }),
      jobTitle: 'Senior Backend Engineer',
      jobDescription: `${JOB}\n- Fluent French is required`,
    })

  it('puts what gets you filtered out above what costs you ranking', () => {
    const severities = weak().suggestions.map((s) => s.severity)

    expect(severities[0]).toBe('critical')
    expect(severities.lastIndexOf('critical')).toBeLessThan(
      severities.indexOf('important') === -1 ? Infinity : severities.indexOf('important'),
    )
  })

  it('keeps notes as the same content, so callers rendering a flat list still work', () => {
    const result = weak()
    expect(result.notes).toEqual(result.suggestions.map((s) => s.detail))
  })

  it('gives the same answer twice for the same input', () => {
    // A score that reshuffles itself between identical runs reads as broken
    // whatever the numbers say.
    expect(weak()).toEqual(weak())
  })
})
