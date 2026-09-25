import type { ParsedResume } from './ai/provider'
import type { EducationEntry, ExperienceEntry, Profile } from './schema'

/**
 * Regex-based resume parsing, for when no AI key is configured.
 *
 * This can only ever get the contact details and links — it has no way to
 * segment work history into distinct roles, which is why `experience` and
 * `education` are left to the AI tier. But it's free, instant, and runs on
 * every upload regardless of whether AI is set up, so contact info gets
 * filled even for someone who never touches the AI tab.
 */

/** Exported so `lib/ats.ts` tests the same notion of "has contact details". */
export const EMAIL_RE = /[a-z0-9][a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}/i

// Loose on purpose: resumes format phone numbers wildly differently across
// countries. This accepts an optional leading + and 7–15 digits with common
// separators, which is permissive enough to catch nearly all of them while
// still rejecting things like a 4-digit zip code.
export const PHONE_RE = /(?:\+?\d[\d\s().-]{8,17}\d)/

const LINKEDIN_RE = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/(?:in|pub)\/[a-z0-9\-_%]+\/?/i
const GITHUB_RE = /(?:https?:\/\/)?(?:www\.)?github\.com\/[a-z0-9\-_]+\/?/i
const GENERIC_URL_RE = /(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s,;)]*)?/gi

/** Header words that mean "this line is a section title", not a person's name. */
const NON_NAME_LINE = /^(resume|cv|curriculum vitae|profile|contact|summary|objective|about)\b/i

function normalizeUrl(match: string): string {
  return /^https?:\/\//i.test(match) ? match : `https://${match}`
}

function pluckFirst(re: RegExp, text: string): string {
  return re.exec(text)?.[0]?.trim() ?? ''
}

/** Split points resumes use to pack "Name | email | phone | LinkedIn" onto one line. */
const HEADER_SEPARATOR_RE = /\s*[|•·]\s*|\s{2,}/

function looksLikeName(line: string): boolean {
  if (line.length < 3 || line.length > 60) return false
  if (NON_NAME_LINE.test(line)) return false
  if (EMAIL_RE.test(line) || /\d{3}/.test(line)) return false
  if (/https?:\/\/|www\./i.test(line)) return false

  const words = line.split(/\s+/).filter(Boolean)
  if (words.length < 2 || words.length > 4) return false
  // Real names are words, not a sentence — bail if anything looks like prose.
  return !words.some((w) => w.length > 20)
}

/**
 * A resume's first line is its candidate's name in the overwhelming majority
 * of layouts — parsers across the industry lean on this because there's no
 * more reliable structural signal once formatting is gone and all you have
 * is plain text.
 *
 * Some templates lay the contact block out beside the name rather than under
 * it, which — once flattened to plain text — reads as one line: "Ada
 * Lovelace | ada@example.com | +1 415…". The whole line fails the plausible-
 * name check, so the first segment is also tried on its own.
 */
function guessName(text: string): { firstName: string; lastName: string } | null {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

  for (const line of lines.slice(0, 5)) {
    const candidate = looksLikeName(line) ? line : line.split(HEADER_SEPARATOR_RE)[0]?.trim()

    if (!candidate || !looksLikeName(candidate)) continue

    const [first, ...rest] = candidate.split(/\s+/).filter(Boolean)
    if (!first) continue
    return { firstName: first, lastName: rest.join(' ') }
  }

  return null
}

/** The lines under a "Skills" (or similar) heading, before the next heading. */
function guessSkills(text: string): string[] {
  const lines = text.split('\n').map((l) => l.trim())
  const headingIdx = lines.findIndex((l) => /^(technical\s+)?skills\b/i.test(l))
  if (headingIdx < 0) return []

  const collected: string[] = []
  for (let i = headingIdx + 1; i < lines.length && i < headingIdx + 12; i += 1) {
    const line = lines[i]
    if (!line) {
      if (collected.length) break
      continue
    }
    // A short, title-cased line with no lowercase-sentence punctuation reads
    // as the next section heading, not more skills.
    if (/^[A-Z][A-Za-z ]{2,30}$/.test(line) && !line.includes(',') && i > headingIdx + 1) break
    collected.push(line)
  }

  return collected
    .join(', ')
    // A table-laid-out skills block (common in DOCX resumes) joins cells with
    // a double space rather than a delimiter character, so that counts too.
    .split(/[,;•|•\t]|\s{2,}/)
    .map((s) => s.replace(/^[-–\s]+|[-–\s]+$/g, ''))
    .filter((s) => s.length > 1 && s.length < 40)
}

export function heuristicParseResume(rawText: string): ParsedResume {
  const text = rawText.replace(/\r\n/g, '\n')
  const result: ParsedResume = {}

  const email = pluckFirst(EMAIL_RE, text)
  if (email) result.email = email

  const linkedin = pluckFirst(LINKEDIN_RE, text)
  if (linkedin) result.linkedinUrl = normalizeUrl(linkedin)

  const github = pluckFirst(GITHUB_RE, text)
  if (github) result.githubUrl = normalizeUrl(github)

  // A portfolio/personal site is whatever generic URL isn't the email domain,
  // LinkedIn or GitHub — resumes rarely list more than one or two links.
  const genericUrls = Array.from(text.matchAll(GENERIC_URL_RE)).map((m) => m[0])
  const portfolio = genericUrls.find(
    (url) => !/linkedin\.com|github\.com/i.test(url) && !(email && url.includes(email.split('@')[1] ?? '\u0000')),
  )
  if (portfolio) result.portfolioUrl = normalizeUrl(portfolio)

  const phoneMatch = PHONE_RE.exec(text)
  if (phoneMatch) {
    const digits = phoneMatch[0].replace(/\D/g, '')
    // A bare run of 7-15 digits is genuinely ambiguous with other numeric
    // content (dates, addresses) — only trust it once it's in phone range.
    if (digits.length >= 7 && digits.length <= 15) {
      result.phone = phoneMatch[0].trim()
    }
  }

  const name = guessName(text)
  if (name) {
    result.firstName = name.firstName
    result.lastName = name.lastName
  }

  const skills = guessSkills(text)
  if (skills.length) result.skills = skills

  return result
}

// ---------------------------------------------------------------------------
// Merging a parse result into a profile
// ---------------------------------------------------------------------------

/** Scalar profile fields a resume parse can fill, mapped 1:1 by name. */
const SCALAR_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'phoneCountryCode', 'addressLine1',
  'city', 'state', 'postalCode', 'country', 'linkedinUrl', 'portfolioUrl',
  'githubUrl', 'headline', 'summary', 'currentTitle', 'currentCompany',
] as const satisfies ReadonlyArray<keyof Profile & keyof ParsedResume>

export type ResumeMergeResult = {
  profile: Profile
  /** Field labels that were actually written, for the summary shown to the user. */
  filled: string[]
  /** Fields the parse found but left alone because you'd already filled them in. */
  skipped: string[]
}

const FIELD_LABELS: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  phoneCountryCode: 'Phone country code',
  addressLine1: 'Street address',
  city: 'City',
  state: 'State',
  postalCode: 'Postal code',
  country: 'Country',
  linkedinUrl: 'LinkedIn',
  portfolioUrl: 'Portfolio',
  githubUrl: 'GitHub',
  headline: 'Headline',
  summary: 'Summary',
  currentTitle: 'Current title',
  currentCompany: 'Current company',
  yearsExperience: 'Years of experience',
  skills: 'Skills',
  languages: 'Languages',
  experience: 'Work experience',
  education: 'Education',
}

/**
 * Apply a parse result to a profile.
 *
 * The rule throughout is: fill what's empty, never touch what isn't. A resume
 * parse runs against whatever the form already holds — including edits made
 * after a previous parse — so overwriting a non-empty field would silently
 * discard something the user typed on purpose.
 */
export function mergeParsedResume(profile: Profile, parsed: ParsedResume): ResumeMergeResult {
  const next: Profile = { ...profile }
  const filled: string[] = []
  const skipped: string[] = []

  for (const field of SCALAR_FIELDS) {
    const value = parsed[field]
    if (!value) continue

    if (profile[field].trim()) {
      skipped.push(FIELD_LABELS[field] ?? field)
    } else {
      next[field] = value
      filled.push(FIELD_LABELS[field] ?? field)
    }
  }

  if (parsed.yearsExperience !== undefined) {
    if (profile.yearsExperience > 0) {
      skipped.push(FIELD_LABELS['yearsExperience'] ?? 'Years of experience')
    } else {
      next.yearsExperience = parsed.yearsExperience
      filled.push(FIELD_LABELS['yearsExperience'] ?? 'Years of experience')
    }
  }

  if (parsed.skills?.length) {
    if (profile.skills.length) {
      skipped.push(FIELD_LABELS['skills'] ?? 'Skills')
    } else {
      next.skills = parsed.skills
      filled.push(FIELD_LABELS['skills'] ?? 'Skills')
    }
  }

  if (parsed.languages?.length) {
    if (profile.languages.length) {
      skipped.push(FIELD_LABELS['languages'] ?? 'Languages')
    } else {
      next.languages = parsed.languages
      filled.push(FIELD_LABELS['languages'] ?? 'Languages')
    }
  }

  if (parsed.experience?.length) {
    if (profile.experience.length) {
      skipped.push(FIELD_LABELS['experience'] ?? 'Work experience')
    } else {
      next.experience = parsed.experience.map(
        (entry): ExperienceEntry => ({ id: crypto.randomUUID(), ...entry }),
      )
      filled.push(`Work experience (${parsed.experience.length})`)
    }
  }

  if (parsed.education?.length) {
    if (profile.education.length) {
      skipped.push(FIELD_LABELS['education'] ?? 'Education')
    } else {
      next.education = parsed.education.map(
        (entry): EducationEntry => ({ id: crypto.randomUUID(), ...entry }),
      )
      filled.push(`Education (${parsed.education.length})`)
    }
  }

  return { profile: next, filled, skipped }
}

/**
 * Merge two parse results, letting AI-sourced values win over heuristic ones
 * for any field both found. Used when AI parsing runs after the (always-on)
 * heuristic pass already produced a result.
 */
export function preferParsed(base: ParsedResume, better: ParsedResume): ParsedResume {
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(better)) {
    if (value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    merged[key] = value
  }
  // Every key/value pair above came straight from a real ParsedResume, so the
  // combined object still satisfies the shape — this cast just tells TS what
  // the untyped Object.entries loop already guaranteed.
  return merged as ParsedResume
}
