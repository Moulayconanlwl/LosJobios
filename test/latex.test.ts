import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RESUME_TEMPLATE,
  coverLetterToLatex,
  escapeLatex,
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
  it('escapes everything substituted in, including the awkward bits', () => {
    const tex = resumeToLatex(renderResume(profileWith(), TAILORED))

    expect(tex).toContain('Smith \\& Co')
    expect(tex).toContain('99.9\\% uptime')
    expect(tex).toContain('C\\#')
    // Nothing raw survived.
    expect(tex).not.toMatch(/[^\\]&/)
  })

  it('keeps the template structure intact', () => {
    const tex = resumeToLatex(renderResume(profileWith(), TAILORED))

    expect(tex).toContain('\\documentclass')
    expect(tex).toContain('\\begin{document}')
    expect(tex).toContain('\\end{document}')
    expect(tex).not.toContain('{{')
  })

  it('renders bullets as an itemize block', () => {
    const tex = resumeToLatex(renderResume(profileWith(), TAILORED))
    expect(tex).toContain('\\begin{itemize}')
    expect(tex).toContain('\\item Cut costs by 30\\%')
  })

  it('uses a supplied template instead of the default', () => {
    const tex = resumeToLatex(renderResume(profileWith(), TAILORED), 'ONLY {{NAME}}')
    expect(tex).toBe('ONLY Ada Lovelace')
  })

  it('produces a document even from an empty profile', () => {
    const empty = renderResume(defaultProfile(), {
      summary: '',
      skills: [],
      roles: [],
      notes: [],
      generatedAt: 0,
    })
    const tex = resumeToLatex(empty)

    expect(tex).toContain('\\begin{document}')
    expect(tex).not.toContain('{{')
    expect(DEFAULT_RESUME_TEMPLATE).toContain('{{NAME}}')
  })
})

describe('coverLetterToLatex', () => {
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

  it('falls back to a generic addressee when the company is unknown', () => {
    const tex = coverLetterToLatex(profileWith(), { title: '', company: '' }, 'Hello.')
    expect(tex).toContain('Hiring Team')
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
