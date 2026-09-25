import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RESUME_TEMPLATE,
  coverLetterToLatex,
  detectLetterLanguage,
  escapeLatex,
  escapeLatexUrl,
  escapeParagraphs,
  fillTemplate,
  resumeToLatex,
  slug,
} from '@/lib/latex'
import { renderResume } from '@/lib/tailored-resume'
import { defaultProfile, type Profile, type TailoredResume } from '@/lib/schema'

/**
 * LaTeX escaping is all-or-nothing: one unescaped character and the document
 * doesn't compile, with an error pointing at the template rather than the
 * data that caused it. The cases here are the ones that actually turn up in
 * a CV — "Smith & Co", "99.9% uptime", "C#", a Windows path in a project
 * description — plus the ordering trap that makes a naive implementation
 * double-escape its own backslashes.
 */

describe('escapeLatex', () => {
  it('escapes the characters that break a build', () => {
    expect(escapeLatex('Smith & Co')).toBe('Smith \\& Co')
    expect(escapeLatex('99.9% uptime')).toBe('99.9\\% uptime')
    expect(escapeLatex('$40k budget')).toBe('\\$40k budget')
    expect(escapeLatex('C# and F#')).toBe('C\\# and F\\#')
    expect(escapeLatex('snake_case')).toBe('snake\\_case')
    expect(escapeLatex('{braces}')).toBe('\\{braces\\}')
  })

  it('escapes a backslash without then escaping its own output', () => {
    // The order trap: escaping backslashes after the others would mangle the
    // backslashes this function just introduced.
    expect(escapeLatex('C:\\Users')).toBe('C:\\textbackslash{}Users')
    expect(escapeLatex('a & b \\ c')).toBe('a \\& b \\textbackslash{} c')
  })

  it('terminates the accent characters so they do not eat the next letter', () => {
    expect(escapeLatex('~/projects')).toBe('\\textasciitilde{}/projects')
    expect(escapeLatex('2^10')).toBe('2\\textasciicircum{}10')
  })

  it('leaves ordinary text alone', () => {
    expect(escapeLatex('Built a payments platform in Python.')).toBe(
      'Built a payments platform in Python.',
    )
  })

  it('handles an empty string', () => {
    expect(escapeLatex('')).toBe('')
  })
})

describe('escapeParagraphs', () => {
  it('keeps paragraph breaks and escapes each one', () => {
    const result = escapeParagraphs('Dear R&D team,\n\nI build things.\n\nThanks')
    expect(result).toBe('Dear R\\&D team,\n\nI build things.\n\nThanks')
  })

  it('folds a single newline into a space, as LaTeX would', () => {
    expect(escapeParagraphs('one\ntwo')).toBe('one two')
  })
})

describe('fillTemplate', () => {
  it('fills the slots it knows', () => {
    expect(fillTemplate('Hello {{NAME}}', { NAME: 'Ada' })).toBe('Hello Ada')
  })

  it('leaves an unknown slot in place rather than blanking it', () => {
    // Silently deleting part of someone's own template would be worse than
    // leaving a visible marker they can find.
    expect(fillTemplate('{{NAME}} {{MYSTERY}}', { NAME: 'Ada' })).toBe('Ada {{MYSTERY}}')
  })

  it('does not treat LaTeX braces as slots', () => {
    const template = String.raw`\textbf{bold} {{NAME}}`
    expect(fillTemplate(template, { NAME: 'Ada' })).toBe(String.raw`\textbf{bold} Ada`)
  })
})

function profileWith(): Profile {
  return {
    ...defaultProfile(),
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    phoneCountryCode: '+44',
    phone: '7700 900123',
    city: 'London',
    skills: ['C#', 'Python'],
    experience: [
      {
        id: 'a',
        company: 'Smith & Co',
        title: 'Engineer',
        location: 'London',
        startDate: '2019',
        endDate: '',
        current: true,
        description: '',
      },
    ],
    education: [],
  }
}

const TAILORED: TailoredResume = {
  summary: 'Engineer with 99.9% uptime experience.',
  skills: ['C#', 'Python'],
  roles: [{ index: 0, bullets: ['Cut costs by 30% at Smith & Co.'] }],
  notes: [],
  generatedAt: 0,
}

describe('resumeToLatex', () => {
  const tex = () => resumeToLatex(renderResume(profileWith(), TAILORED), profileWith())

  it('escapes everything substituted in, including the awkward bits', () => {
    const result = tex()

    expect(result).toContain('Smith \\& Co')
    expect(result).toContain('99.9\\% uptime')
    expect(result).toContain('C\\#')
  })

  it('keeps the template structure intact', () => {
    const result = tex()

    expect(result).toContain('\\documentclass')
    expect(result).toContain('\\begin{document}')
    expect(result).toContain('\\end{document}')
    expect(result).not.toContain('{{')
  })

  it('uses the four-argument entry command for each role', () => {
    // The template defines \entry{title}{dates}{company}{location}.
    expect(tex()).toContain('\\entry{Engineer}{2019 – Present}{Smith \\& Co}{London}')
  })

  it('renders bullets as an itemize block', () => {
    expect(tex()).toContain('\\begin{itemize}[leftmargin=14pt')
    expect(tex()).toContain('\\item Cut costs by 30\\%')
  })

  it('builds the icon contact row from the profile', () => {
    const result = tex()
    expect(result).toContain('\\faEnvelope')
    expect(result).toContain('\\href{mailto:ada@example.com}')
  })

  it('uses a supplied template instead of the default', () => {
    const result = resumeToLatex(renderResume(profileWith(), TAILORED), profileWith(), 'ONLY {{NAME}}')
    expect(result).toBe('ONLY Ada Lovelace')
  })

  it('produces a document even from an empty profile', () => {
    const empty = renderResume(defaultProfile(), {
      summary: '',
      skills: [],
      roles: [],
      notes: [],
      generatedAt: 0,
    })
    const result = resumeToLatex(empty, defaultProfile())

    expect(result).toContain('\\begin{document}')
    expect(result).not.toContain('{{')
    expect(DEFAULT_RESUME_TEMPLATE).toContain('{{NAME}}')
  })
})

describe('coverLetterToLatex', () => {
  const english = 'I would love to join your team and I have the experience that role needs.'
  const french =
    'Je vous écris pour le poste que vous proposez. Mon expérience dans des équipes techniques correspond à vos besoins.'

  it('escapes the company and the body', () => {
    const tex = coverLetterToLatex(
      profileWith(),
      { title: 'Engineer', company: 'Smith & Co' },
      'I cut costs by 30% last year.',
    )

    expect(tex).toContain('Smith \\& Co')
    expect(tex).toContain('30\\%')
    expect(tex).not.toContain('{{')
  })

  it('carries the sender block, which is the whole point of a letterhead', () => {
    const tex = coverLetterToLatex(profileWith(), { title: 'Engineer', company: 'Acme' }, english)

    expect(tex).toContain('Ada Lovelace')
    expect(tex).toContain('ada@example.com')
    expect(tex).toContain('\\faPhone')
  })

  it('writes a subject line from the role', () => {
    const tex = coverLetterToLatex(
      profileWith(),
      { title: 'Chef de projet', company: 'Acme' },
      french,
    )
    expect(tex).toContain('Candidature au poste de Chef de projet')
  })

  it('matches the salutation to the language the letter came out in', () => {
    const fr = coverLetterToLatex(profileWith(), { title: 'Chef de projet', company: 'Acme' }, french)
    const en = coverLetterToLatex(profileWith(), { title: 'Engineer', company: 'Acme' }, english)

    // A French letter opening "Dear Hiring Team" is exactly the seam that
    // makes a document look generated.
    expect(fr).toContain('Madame, Monsieur,')
    expect(fr).toContain('salutations distinguées')
    expect(en).toContain('Dear Hiring Team,')
    expect(en).not.toContain('Madame, Monsieur,')
  })

  it('dates the letter from the sender city', () => {
    const tex = coverLetterToLatex(profileWith(), { title: 'Chef de projet', company: 'Acme' }, french)
    expect(tex).toMatch(/London, le \d/)
  })

  it('falls back to a generic addressee when the company is unknown', () => {
    const tex = coverLetterToLatex(profileWith(), { title: '', company: '' }, english)
    expect(tex).toContain('Hiring Team')
  })
})

describe('detectLetterLanguage', () => {
  it('spots a French letter', () => {
    expect(
      detectLetterLanguage(
        'Je vous adresse ma candidature pour le poste de chef de projet dans votre équipe.',
      ),
    ).toBe('fr')
  })

  it('spots an English letter', () => {
    expect(
      detectLetterLanguage('I am writing about the role on your team and what I would bring to it.'),
    ).toBe('en')
  })

  it('defaults to French for an empty body, matching the template', () => {
    expect(detectLetterLanguage('')).toBe('fr')
  })
})

describe('escapeLatexUrl', () => {
  it('escapes only what TeX would eat before hyperref sees it', () => {
    expect(escapeLatexUrl('https://x.com/a%20b')).toBe('https://x.com/a\\%20b')
    expect(escapeLatexUrl('https://x.com/a#b')).toBe('https://x.com/a\\#b')
  })

  it('leaves an underscore alone, which would otherwise corrupt the link', () => {
    expect(escapeLatexUrl('https://x.com/my_profile')).toBe('https://x.com/my_profile')
  })
})

describe('slug', () => {
  it('makes a filename-safe name', () => {
    expect(slug('Smith & Co')).toBe('smith-co')
    expect(slug('Qvest Global (m/f/d)')).toBe('qvest-global-m-f-d')
  })

  it('falls back when there is nothing usable', () => {
    expect(slug('')).toBe('role')
    expect(slug('!!!')).toBe('role')
  })
})
