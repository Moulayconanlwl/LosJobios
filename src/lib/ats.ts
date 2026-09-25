import { EMAIL_RE, PHONE_RE } from './resume-heuristics'
import type { Profile } from './schema'

/**
 * A deterministic, offline ATS score.
 *
 * An applicant tracking system is, mechanically, a parser followed by a
 * keyword matcher: the posting's terms are extracted, your resume is
 * flattened to plain text, and what doesn't match doesn't rank. That's a
 * mechanical process rather than a judgement call, so this models it
 * mechanically — no model in the loop. It runs instantly, costs nothing,
 * needs no API key, and gives the same answer twice for the same input.
 *
 * `AIProvider.reviewResume` is the separate, optional layer that adds the
 * judgement: what to actually rewrite. The two are kept apart deliberately.
 * A model asked to "score this out of 100" invents a plausible-looking
 * number, and two different scores on one screen is worse than one honest
 * one.
 */

export type AtsComponentId = 'keywords' | 'title' | 'experience' | 'parseability'

export type AtsComponent = {
  id: AtsComponentId
  label: string
  /** 0..1. */
  score: number
  /** Relative worth, before renormalizing over the components that applied. */
  weight: number
  detail: string
}

export type AtsKeyword = {
  term: string
  weight: number
}

export type AtsScore = {
  /** 0..100. */
  score: number
  /** Only the components that could actually be computed for this input. */
  components: AtsComponent[]
  matched: string[]
  missing: string[]
  notes: string[]
}

export type AtsInput = {
  resumeText: string
  profile: Profile
  jobTitle: string
  jobDescription: string
}

const WEIGHTS: Record<AtsComponentId, number> = {
  keywords: 55,
  title: 15,
  experience: 15,
  parseability: 15,
}

/**
 * Words that carry no signal for keyword matching: ordinary English, plus the
 * boilerplate every job posting is built from. "Experience", "requirements"
 * and "team" appear in all of them, so matching on those would score every
 * resume against every job as a near-perfect fit.
 *
 * Genuine signal — a technology, a domain, a seniority-bearing job noun — is
 * deliberately absent from this list.
 */
const STOPWORDS = new Set<string>(
  `a about above across after again against all also am an and any are as at
   be because been before being below between both but by
   can could did do does doing down during
   each either else etc even ever every
   few for from further
   had has have having he her here hers him his how however
   i if in into is it its itself
   just
   may me might more most much must my
   no nor not now
   of off on once only or other others our ours out over own
   per
   same shall she should so some such
   than that the their theirs them then there these they this those through to too
   under until up upon us use used using
   very
   was we were what when where whether which while who whom why will with within without would
   you your yours

   ability able additional applicant apply applications background benefits bonus
   candidate candidates career colleagues commitment community company compensation competitive culture curious
   day days description desirable detail directly diverse diversity dynamic employee employer employment
   environment equal exceptional excellent exciting experience experienced exposure expertise
   familiar familiarity fast focus full future global good great group growing growth
   help high highly hire hiring ideal impact including inclusive individual industry
   join key knowledge level like looking love
   make making member members mission months motivated
   need needs new nice offer office opportunity organization
   paced part partner passionate people plus position positions preferred prior professional proven provide
   qualifications qualified quality
   real really requirement requirements required responsibilities responsibility role roles
   salary seeking self service services set skill skills someone strong successful
   task tasks team teams technologies technology thrive time tools top track
   understanding
   value values various
   want well work working world
   year years`
    .trim()
    .split(/\s+/),
)

/** Lines that state a requirement, where a term counts for more. */
const EMPHASIS_RE =
  /(requir|must have|must be|need to|proficien|experience (?:with|in|using)|knowledge of|familiar|expertise|background in|you have|you'?ll|skills?:|qualificat)/i

const BULLET_RE = /^\s*[-•*–—·]/

/**
 * Punctuation a phrase can't span. "Python, Go" is two skills listed, not the
 * phrase "python go" — and letting one form would also suppress the two real
 * terms inside it. A hyphen only breaks a phrase when it's spaced, so
 * "event-driven" stays one idea.
 */
const SEGMENT_RE = /[,;:/()[\]|•·]|\s[-–—]\s/

/** Headings an ATS parser looks for when splitting a resume into sections. */
const SECTION_PATTERNS = [
  /\b(experience|employment|work history)\b/i,
  /\b(education|degree|university|bachelor|master)\b/i,
  /\b(skills|technologies|competencies)\b/i,
]

/**
 * Split text into comparable tokens.
 *
 * `+`, `#` and `.` survive the first pass so "c++", "c#" and "node.js" stay
 * whole, then leading/trailing dots come off so a term at the end of a
 * sentence ("we use Python.") still matches the same term written anywhere
 * else.
 */
function normalizeTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ''))
    .filter(Boolean)
}

/**
 * A space-padded token stream. Padding is what makes `containsTerm` an exact
 * token-sequence match rather than a substring one — without it "java" would
 * happily match inside "javascript".
 */
function haystackOf(...parts: string[]): string {
  return ` ${normalizeTokens(parts.join(' ')).join(' ')} `
}

function containsTerm(haystack: string, term: string): boolean {
  return haystack.includes(` ${term} `)
}

function isMeaningful(token: string): boolean {
  if (token.length < 2) return false
  // Must carry a letter: "5+" out of "5+ years" is not a skill, while "c++"
  // and "c#" are.
  if (!/[a-z]/.test(token)) return false
  return !STOPWORDS.has(token)
}

type TermStat = {
  count: number
  emphasized: boolean
  /** True for two-word phrases, which are a stronger signal than either word. */
  phrase: boolean
  /** First-seen position, used to break weight ties in the posting's own order. */
  order: number
}

/**
 * The terms a keyword matcher would pull out of this posting, strongest
 * first. Two-word phrases are collected alongside single words because
 * "machine learning" and "product management" are what actually gets
 * searched for — and a word that only ever appears inside a kept phrase is
 * dropped, so the list doesn't say "learning" and "machine learning" twice.
 */
export function extractJobKeywords(jobDescription: string, limit = 24): AtsKeyword[] {
  const stats = new Map<string, TermStat>()
  let order = 0

  const bump = (term: string, emphasized: boolean, phrase: boolean) => {
    const existing = stats.get(term)
    if (existing) {
      existing.count += 1
      existing.emphasized ||= emphasized
      return
    }
    order += 1
    stats.set(term, { count: 1, emphasized, phrase, order })
  }

  for (const line of jobDescription.split('\n')) {
    const emphasized = BULLET_RE.test(line) || EMPHASIS_RE.test(line)

    for (const segment of line.split(SEGMENT_RE)) {
      const tokens = normalizeTokens(segment)

      for (let i = 0; i < tokens.length; i += 1) {
        const token = tokens[i]
        if (!token || !isMeaningful(token)) continue

        bump(token, emphasized, false)

        const next = tokens[i + 1]
        if (next && isMeaningful(next)) bump(`${token} ${next}`, emphasized, true)
      }
    }
  }

  const ranked = Array.from(stats, ([term, stat]) => ({
    term,
    stat,
    // Repetition counts, but with a ceiling — a term named twenty times isn't
    // twenty times more important than one named in the requirements list.
    weight: Math.min(stat.count, 3) + (stat.emphasized ? 1 : 0) + (stat.phrase ? 0.5 : 0),
  }))
    /*
     * A phrase earns its place by recurring. Said once it isn't a term of
     * art, just two adjacent words — "build machine" out of "build machine
     * learning models", "deep java" out of "deep Java expertise" — and
     * keeping it does real damage, because a phrase suppresses the words
     * inside it and those words were the actual skills. A posting that
     * genuinely trades in a phrase says it more than once; one that doesn't
     * still matches on both halves separately, which is nearly the same
     * thing to a keyword matcher.
     */
    .filter(({ stat }) => !stat.phrase || stat.count >= 2)
    .sort((a, b) => b.weight - a.weight || a.stat.order - b.stat.order)

  // Dedupe against a generous slice rather than the final one, so a phrase
  // just outside the cut still suppresses its own constituent words.
  const shortlist = ranked.slice(0, limit * 2)

  /*
   * A sliding window over "event-driven architecture" yields both "event
   * driven" and "driven architecture" — one signal, counted twice, and two
   * near-identical chips in the UI. Keep the strongest phrase out of each
   * overlapping run and drop the rest. Ranked order means the survivor is
   * the heaviest one, and the posting's own order breaks ties.
   */
  const phrases: typeof shortlist = []
  for (const entry of shortlist) {
    if (!entry.stat.phrase) continue
    const words = entry.term.split(' ')
    const overlaps = phrases.some((kept) => kept.term.split(' ').some((w) => words.includes(w)))
    if (!overlaps) phrases.push(entry)
  }

  const kept = shortlist.filter((entry) => {
    if (entry.stat.phrase) return phrases.includes(entry)
    // A phrase can never occur more often than the words inside it, so this
    // only drops a word that never appears outside a phrase we kept.
    return !phrases.some(
      (phrase) =>
        phrase.stat.count >= entry.stat.count && phrase.term.split(' ').includes(entry.term),
    )
  })

  return kept.slice(0, limit).map(({ term, weight }) => ({ term, weight }))
}

/**
 * The years of experience the posting asks for, or null when it doesn't say.
 *
 * Takes the highest credible figure: a posting wanting "8+ years overall, 3+
 * with Python" screens on the 8. Anything above 20 is treated as noise (a
 * stray "in the last 30 years" in a company blurb) rather than a requirement.
 */
export function requiredYears(jobDescription: string): number | null {
  const pattern = /(\d{1,2})\s*(?:\+|-|–|—|to)?\s*(\d{1,2})?\s*\+?\s*years?/gi
  let best: number | null = null

  for (const match of jobDescription.matchAll(pattern)) {
    // The upper bound of a range ("3-5 years") is the bar that's actually screened on.
    const upper = Number(match[2] ?? match[1])
    if (!Number.isFinite(upper) || upper < 1 || upper > 20) continue
    if (best === null || upper > best) best = upper
  }

  return best
}

function candidateHaystack(input: AtsInput): string {
  const { profile } = input
  return haystackOf(
    input.resumeText,
    profile.headline,
    profile.summary,
    profile.currentTitle,
    profile.currentCompany,
    profile.skills.join(' '),
    profile.languages.join(' '),
    ...profile.experience.map((entry) => `${entry.title} ${entry.company} ${entry.description}`),
    ...profile.education.map((entry) => `${entry.school} ${entry.degree} ${entry.field}`),
  )
}

function titleComponent(jobTitle: string, profile: Profile): AtsComponent | null {
  const words = Array.from(new Set(normalizeTokens(jobTitle).filter(isMeaningful)))
  if (!words.length) return null

  const haystack = haystackOf(
    profile.currentTitle,
    profile.headline,
    ...profile.experience.map((entry) => entry.title),
  )
  const hits = words.filter((word) => containsTerm(haystack, word))

  return {
    id: 'title',
    label: 'Title match',
    score: hits.length / words.length,
    weight: WEIGHTS.title,
    detail:
      hits.length === words.length
        ? 'Your own titles already use the posting’s wording.'
        : `Your titles carry ${hits.length} of the ${words.length} meaningful words in “${jobTitle.trim()}”.`,
  }
}

function experienceComponent(required: number, profile: Profile): AtsComponent {
  const held = profile.yearsExperience
  const score = held >= required ? 1 : Math.max(0, held / required)

  return {
    id: 'experience',
    label: 'Years of experience',
    score,
    weight: WEIGHTS.experience,
    detail:
      held >= required
        ? `Clears the ${required} years this posting asks for.`
        : `The posting asks for ${required} years; your profile says ${held}.`,
  }
}

function parseabilityComponent(resumeText: string): { component: AtsComponent; notes: string[] } {
  const text = resumeText.trim()
  const sections = SECTION_PATTERNS.filter((pattern) => pattern.test(text)).length

  const checks = [
    {
      ok: text.length >= 300,
      note: 'Almost no resume text was read. Upload a PDF or DOCX under Profile → Resume, or paste the text, so there is something to match against.',
    },
    {
      ok: EMAIL_RE.test(text),
      note: 'No email address in the resume text — most trackers key your record off the one they parse out of the document.',
    },
    {
      ok: PHONE_RE.test(text),
      note: 'No phone number in the resume text.',
    },
    {
      ok: sections >= 2,
      note: 'Fewer than two standard section headings found. Parsers split a resume on “Experience”, “Education” and “Skills” — without them, everything lands in one undifferentiated blob.',
    },
  ]

  const passed = checks.filter((check) => check.ok).length

  return {
    component: {
      id: 'parseability',
      label: 'Machine readability',
      score: passed / checks.length,
      weight: WEIGHTS.parseability,
      detail: `${passed} of ${checks.length} parser checks pass.`,
    },
    notes: checks.filter((check) => !check.ok).map((check) => check.note),
  }
}

export function scoreResumeAgainstJob(input: AtsInput): AtsScore {
  const keywords = extractJobKeywords(input.jobDescription)
  const haystack = candidateHaystack(input)

  const matched: string[] = []
  const missing: string[] = []
  let matchedWeight = 0
  let totalWeight = 0

  for (const keyword of keywords) {
    totalWeight += keyword.weight
    if (containsTerm(haystack, keyword.term)) {
      matched.push(keyword.term)
      matchedWeight += keyword.weight
    } else {
      missing.push(keyword.term)
    }
  }

  const components: AtsComponent[] = []
  const notes: string[] = []

  if (keywords.length) {
    components.push({
      id: 'keywords',
      label: 'Keyword coverage',
      score: totalWeight ? matchedWeight / totalWeight : 0,
      weight: WEIGHTS.keywords,
      detail: `${matched.length} of the ${keywords.length} terms this posting leans on appear in your resume.`,
    })
  }

  const title = titleComponent(input.jobTitle, input.profile)
  if (title) components.push(title)

  const required = requiredYears(input.jobDescription)
  if (required !== null) components.push(experienceComponent(required, input.profile))

  const parseability = parseabilityComponent(input.resumeText)
  components.push(parseability.component)
  notes.push(...parseability.notes)

  if (missing.length) {
    notes.push(
      `Terms the posting uses that your resume never does: ${missing.slice(0, 8).join(', ')}. Work in the ones you can say honestly — a keyword you can't back up in an interview costs more than it gains.`,
    )
  }

  if (title && title.score < 0.5) {
    notes.push(
      `Neither your headline nor any of your titles reads like “${input.jobTitle.trim()}”. Mirroring the posting's own title wording is one of the cheapest ranking gains there is.`,
    )
  }

  if (required !== null && input.profile.yearsExperience < required) {
    notes.push(
      `The posting screens for ${required} years of experience and your profile says ${input.profile.yearsExperience}. Filters on this are usually a floor, not a preference.`,
    )
  }

  const weightSum = components.reduce((sum, component) => sum + component.weight, 0)
  const weighted = components.reduce(
    (sum, component) => sum + component.score * component.weight,
    0,
  )

  return {
    score: weightSum ? Math.round((weighted / weightSum) * 100) : 0,
    components,
    matched,
    missing,
    notes,
  }
}
