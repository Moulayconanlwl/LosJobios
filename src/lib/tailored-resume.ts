import type { Profile, TailoredResume } from './schema'

/**
 * Turning a tailored resume back into something you can paste.
 *
 * The generated half is only ever wording — a summary, reordered skills and
 * rewritten bullets keyed by role number. Everything factual (who you worked
 * for, what you were called, when) is reattached here from the stored
 * profile, so a model that hallucinated an employer still can't put one on
 * the page.
 */

export type ResumeRole = {
  title: string
  company: string
  location: string
  dates: string
  bullets: string[]
}

export type RenderedResume = {
  name: string
  contact: string[]
  summary: string
  skills: string[]
  roles: ResumeRole[]
  education: string[]
  notes: string[]
}

function roleDates(startDate: string, endDate: string, current: boolean): string {
  const end = current ? 'Present' : endDate
  if (!startDate && !end) return ''
  return [startDate, end].filter(Boolean).join(' – ')
}

/** Reattach the profile's facts to the model's wording. */
export function renderResume(profile: Profile, tailored: TailoredResume): RenderedResume {
  const bulletsFor = new Map(tailored.roles.map((role) => [role.index, role.bullets]))

  const roles = profile.experience.map((entry, index): ResumeRole => {
    const rewritten = bulletsFor.get(index)
    return {
      title: entry.title,
      company: entry.company,
      location: entry.location,
      dates: roleDates(entry.startDate, entry.endDate, entry.current),
      // Falling back to what the candidate wrote keeps a role that the
      // rewrite skipped from vanishing off their own resume.
      bullets: rewritten?.length ? rewritten : entry.description ? [entry.description] : [],
    }
  })

  const education = profile.education.map((entry) => {
    const degree = [entry.degree, entry.field].filter(Boolean).join(' in ')
    const when = entry.endYear ? ` (${entry.endYear})` : ''
    return `${degree || 'Studied'} — ${entry.school || 'Institution'}${when}`
  })

  return {
    name: `${profile.firstName} ${profile.lastName}`.trim(),
    contact: [profile.email, profile.phone, profile.city, profile.linkedinUrl, profile.githubUrl]
      .map((part) => part.trim())
      .filter(Boolean),
    summary: tailored.summary,
    skills: tailored.skills.length ? tailored.skills : profile.skills,
    roles,
    education,
    notes: tailored.notes,
  }
}

/**
 * Plain text, for pasting into a document or an application box. Notes are
 * deliberately left out — they're for the candidate, not the employer.
 */
export function resumeToText(resume: RenderedResume): string {
  const lines: string[] = []

  if (resume.name) lines.push(resume.name)
  if (resume.contact.length) lines.push(resume.contact.join(' | '))

  if (resume.summary) lines.push('', 'SUMMARY', resume.summary)

  if (resume.skills.length) lines.push('', 'SKILLS', resume.skills.join(', '))

  if (resume.roles.length) {
    lines.push('', 'EXPERIENCE')
    for (const role of resume.roles) {
      const heading = [role.title, role.company].filter(Boolean).join(' — ')
      const meta = [role.location, role.dates].filter(Boolean).join(' | ')
      lines.push('', meta ? `${heading} (${meta})` : heading)
      for (const bullet of role.bullets) lines.push(`- ${bullet}`)
    }
  }

  if (resume.education.length) {
    lines.push('', 'EDUCATION')
    for (const entry of resume.education) lines.push(`- ${entry}`)
  }

  return lines.join('\n').trim()
}
