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

export type AtsComponentId =
  | 'keywords'
  | 'title'
  | 'experience'
  | 'parseability'
  | 'requirements'

/**
 * How much a suggestion costs to ignore.
 *
 * Ordered so the list can be read top-down and stopped at any point: a
 * `critical` is something that gets the application filtered out before a
 * human sees it, an `important` is a real ranking loss, and a `polish` is
 * worth doing when the other two are clear.
 */
export type AtsSeverity = 'critical' | 'important' | 'polish'

export type AtsSuggestion = {
  id: string
  severity: AtsSeverity
  /** A few words, for a heading. */
  title: string
  /** What to actually change, in full. */
  detail: string
}

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
  /**
   * Terms the posting wants that your *profile* already claims but your
   * resume text never says. These are the cheapest points on the page:
   * nothing has to become true, the document just has to say what is already
   * true of you.
   */
  easyWins: string[]
  /** Ranked, actionable. `notes` is the same content flattened. */
  suggestions: AtsSuggestion[]
  /** Kept for callers that render a plain list. Derived from `suggestions`. */
  notes: string[]
}

export type AtsInput = {
  resumeText: string
  profile: Profile
  jobTitle: string
  jobDescription: string
}

const WEIGHTS: Record<AtsComponentId, number> = {
  keywords: 50,
  title: 14,
  experience: 13,
  parseability: 13,
  requirements: 10,
}

const words = (block: string): string[] => block.trim().split(/\s+/).filter(Boolean)

/** Ordinary English, and the boilerplate every English posting is built from. */
const ENGLISH_STOPWORDS = words(`
  a about above across after again against all also am an and any are as at
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
  year years
`)

/**
 * French grammar words.
 *
 * Written unaccented because tokens are folded before they reach here — "à"
 * is already "a", "être" already "etre".
 *
 * Without these, a French posting's heaviest "keywords" are its grammar: "et",
 * "la", "de" and "des" outnumber every real term, and the phrase builder then
 * emits "de projet" where the actual term is "projet".
 */
const FRENCH_STOPWORDS = words(`
  a au aux avec ce ces cet cette chez dans de des du elle elles en et eux
  il ils je la le les leur leurs lui ma mais me meme memes mes moi mon ne
  nos notre nous on ou par pas plus pour qu que qui sa sans se ses si son
  sur ta te tes toi ton tous tout toute toutes tu un une vos votre vous y
  est sont etre ete avoir avons ont fait faire font plusieurs autre autres
  afin ainsi alors apres aussi avant beaucoup bien comme donc dont encore
  entre lors lorsque meilleur moins non pendant peut peuvent selon sous
  tres via vers deja depuis
`)

/** The French counterpart of the English job-ad boilerplate above. */
const FRENCH_BOILERPLATE = words(`
  candidat candidats candidature candidatures capacite capacites
  collaborateur collaborateurs competence competences connaissance
  connaissances contexte contrat description entreprise environnement
  equipe equipes experience experiences formation groupe maitrise mission
  missions niveau offre opportunite poste postes profil profils qualites
  recherche recherchons recrutement remuneration rejoindre role salaire
  societe statut talent talents tache taches
`)

/**
 * Job-board page furniture.
 *
 * These reach the scorer whenever a posting's text picks up the site's own
 * chrome — "Easy Apply", "Over 100 applicants", "Reposted 3 hours ago". They
 * appear in no job description, so matching on them scores every resume
 * against every posting on that board identically.
 */
const BOARD_CHROME = words(`
  ago applicants applied easy easily hirer promoted reposted viewed
  hour hours minute minutes heure heures
  actively reviewing recruiter responses response insights premium
  reactivate unlock exclusive
  linkedin indeed glassdoor
`)

/**
 * Words that carry no signal for keyword matching: ordinary English, plus the
 * boilerplate every job posting is built from. "Experience", "requirements"
 * and "team" appear in all of them, so matching on those would score every
 * resume against every job as a near-perfect fit.
 *
 * Genuine signal — a technology, a domain, a seniority-bearing job noun — is
 * deliberately absent from this list.
 */
const STOPWORDS = new Set<string>([
  ...ENGLISH_STOPWORDS,
  ...FRENCH_STOPWORDS,
  ...FRENCH_BOILERPLATE,
  ...BOARD_CHROME,
])

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
  return (
    value
      .toLowerCase()
      /*
       * Fold accents to plain letters *before* anything is stripped.
       *
       * Without this, the character class below deletes every accented letter
       * and splits the word around the hole: "systèmes" became "syst" and
       * "mes", "expérience" became "exp" and "rience", "compétences" became
       * "comp" and "tences". Those fragments then scored as keywords, so a
       * French posting was matched on nonsense and the real terms were never
       * seen at all.
       *
       * Folding rather than permitting accents also makes the two spellings
       * one term, so a CV written "experience" matches a posting written
       * "expérience" — which is the common case, not an edge one.
       */
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9+#.\s]/g, ' ')
      .split(/\s+/)
      .map((token) => token.replace(/^\.+|\.+$/g, ''))
      .filter(Boolean)
  )
}

/**
 * Suffixes stripped when comparing two words, longest first.
 *
 * The posting says "managing a team", the resume says "managed a team", and a
 * literal matcher scores that a miss — which is both wrong and demoralising,
 * because there is nothing to fix. This is not real stemming; it is the
 * smallest reduction that collapses the tense and plural differences that
 * actually occur between a job ad and a CV.
 */
const SUFFIXES = ['ments', 'ment', 'ions', 'ion', 'ings', 'ing', 'ers', 'er', 'ies', 'ed', 'es', 's']

/** The shortest a reduced word may be. Below this, suffix-stripping is noise. */
const MIN_STEM = 3

/**
 * Reduce a token to its comparison form.
 *
 * The trailing `e` comes off last and unconditionally, which is what makes
 * "manage", "managed", "managing", "manager" and "management" all land on the
 * same stem — without it "management" reduces to "manage" and "managing" to
 * "manag", and the pair still misses.
 *
 * Short tokens are returned untouched. That is deliberate and load-bearing:
 * "go", "java", "ios" and "data" are whole terms, and stripping letters off
 * them is how "Go" the language starts matching "going".
 */
export function stem(token: string): string {
  if (token.length <= 4) return token

  for (const suffix of SUFFIXES) {
    if (!token.endsWith(suffix)) continue
    const stripped = token.slice(0, -suffix.length)
    if (stripped.length >= MIN_STEM) return dropTrailingE(stripped)
  }

  return dropTrailingE(token)
}

function dropTrailingE(token: string): string {
  return token.length > MIN_STEM && token.endsWith('e') ? token.slice(0, -1) : token
}

/**
 * Terms an applicant tracking system's own synonym list would treat as one.
 *
 * This is the single biggest source of false misses in a naive matcher: a
 * resume saying "K8s" scores zero against a posting saying "Kubernetes", and
 * the advice that follows — "add Kubernetes" — is advice to write down
 * something you already wrote down. Each row is a set of writings of one
 * thing, never a set of related things: "React" and "React Native" are two
 * skills and are deliberately not in here.
 */
const EQUIVALENTS: string[][] = [
  ['javascript', 'js', 'ecmascript'],
  ['typescript', 'ts'],
  ['kubernetes', 'k8s'],
  ['machine learning', 'ml'],
  ['artificial intelligence', 'ai'],
  ['natural language processing', 'nlp'],
  ['continuous integration', 'ci'],
  ['continuous delivery', 'continuous deployment', 'cd'],
  ['amazon web services', 'aws'],
  ['google cloud platform', 'gcp'],
  ['microsoft azure', 'azure'],
  ['postgresql', 'postgres'],
  ['mongodb', 'mongo'],
  ['kubernetes cluster', 'k8s cluster'],
  ['infrastructure as code', 'iac'],
  ['user interface', 'ui'],
  ['user experience', 'ux'],
  ['quality assurance', 'qa'],
  ['product manager', 'product management', 'pm'],
  ['software as a service', 'saas'],
  ['rest api', 'restful api', 'rest'],
  ['object oriented', 'oop'],
  ['test driven development', 'tdd'],
  ['version control', 'git'],
  ['github actions', 'gh actions'],
  ['dot net', '.net', 'dotnet'],
  ['c sharp', 'c#'],
  ['golang', 'go'],
  ['node.js', 'nodejs', 'node'],
  ['react.js', 'reactjs', 'react'],
  ['vue.js', 'vuejs', 'vue'],
  ['deep learning', 'dl'],
  ['business intelligence', 'bi'],
  ['extract transform load', 'etl'],
  ['service level agreement', 'sla'],
  ['software development kit', 'sdk'],
]

/** term (stemmed) → every stemmed writing of the same thing, including itself. */
const ALIASES: Map<string, string[]> = (() => {
  const map = new Map<string, string[]>()
  for (const group of EQUIVALENTS) {
    const stemmed = group.map(stemPhrase)
    for (const member of stemmed) {
      // A term appearing in two groups keeps both sets rather than losing one.
      map.set(member, [...(map.get(member) ?? []), ...stemmed])
    }
  }
  return map
})()

function stemPhrase(phrase: string): string {
  const tokens = normalizeTokens(phrase)
  // An alias that normalizes away entirely (".net" → "net") keeps its literal
  // form rather than becoming the empty string, which would match everything.
  if (!tokens.length) return phrase.toLowerCase().trim()
  return tokens.map(stem).join(' ')
}

/**
 * Every stemmed word and adjacent word-pair in some text.
 *
 * A set of exact keys rather than a padded string: the padding trick made
 * "java" not match inside "javascript", which a set does by construction, and
 * this also stops being a substring scan of the whole resume per keyword.
 */
function matchIndex(...parts: string[]): Set<string> {
  const tokens = normalizeTokens(parts.join(' ')).map(stem)
  const index = new Set<string>()

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!token) continue
    index.add(token)

    const next = tokens[i + 1]
    if (next) index.add(`${token} ${next}`)
  }

  return index
}

/** Is this term — or any other writing of it — present? */
function containsTerm(index: Set<string>, term: string): boolean {
  const key = stemPhrase(term)
  if (index.has(key)) return true

  for (const alias of ALIASES.get(key) ?? []) {
    if (index.has(alias)) return true
  }
  return false
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

/** Everything a parser would read about the candidate, from both sources. */
function candidateIndex(input: AtsInput): Set<string> {
  const { profile } = input
  return matchIndex(
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

/**
 * Seniority words, weakest first.
 *
 * A separate axis from the rest of the title, because it is the part a
 * recruiter filters on hardest and the part keyword overlap is blindest to:
 * "Junior Developer" and "Senior Developer" share every meaningful word.
 */
const SENIORITY = [
  { rank: 1, words: ['intern', 'internship', 'stage', 'stagiaire', 'trainee', 'apprentice', 'alternance'] },
  { rank: 2, words: ['junior', 'entry', 'graduate', 'débutant', 'debutant'] },
  { rank: 3, words: ['mid', 'intermediate', 'confirmé', 'confirme'] },
  { rank: 4, words: ['senior', 'sr', 'experienced'] },
  { rank: 5, words: ['staff', 'lead', 'principal', 'head', 'director', 'manager', 'chief'] },
]

/** The highest seniority word present, or null when nothing says. */
function seniorityOf(value: string): { rank: number; word: string } | null {
  const tokens = new Set(normalizeTokens(value))
  let best: { rank: number; word: string } | null = null

  for (const level of SENIORITY) {
    for (const word of level.words) {
      if (tokens.has(word) && (!best || level.rank > best.rank)) best = { rank: level.rank, word }
    }
  }
  return best
}

function titleComponent(jobTitle: string, profile: Profile): AtsComponent | null {
  const words = Array.from(new Set(normalizeTokens(jobTitle).filter(isMeaningful)))
  if (!words.length) return null

  const index = matchIndex(
    profile.currentTitle,
    profile.headline,
    ...profile.experience.map((entry) => entry.title),
  )
  const hits = words.filter((word) => containsTerm(index, word))

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

/** A month-and-year in the forms a resume writes one. */
const DATE_RE =
  /\b(19|20)\d{2}\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec)[a-zé]*\.?\s*(19|20)?\d{2}\b/i

/**
 * Characters that turn up when a PDF's text layer is broken — ligature and
 * bullet glyphs that didn't map back to letters. A few are normal; a lot means
 * the parser on the other end is reading gibberish too.
 */
const NOISE_RE = /[�-•●▪]/g

function parseabilityComponent(resumeText: string): {
  component: AtsComponent
  suggestions: AtsSuggestion[]
} {
  const text = resumeText.trim()
  const sections = SECTION_PATTERNS.filter((pattern) => pattern.test(text)).length
  const noiseRatio = text.length ? (text.match(NOISE_RE)?.length ?? 0) / text.length : 0

  // A resume with no line breaks at all is the signature of a multi-column or
  // table layout: the extractor got one run of text and so will the tracker.
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  const singleBlob = text.length > 600 && lines.length < 5

  const checks: Array<{ ok: boolean; suggestion: AtsSuggestion }> = [
    {
      ok: text.length >= 300,
      suggestion: {
        id: 'no-resume-text',
        severity: 'critical',
        title: 'No resume text to match',
        detail:
          'Almost no resume text was read. Upload a PDF or DOCX under Profile → Resume, or paste the text, so there is something to match against.',
      },
    },
    {
      ok: EMAIL_RE.test(text),
      suggestion: {
        id: 'no-email',
        severity: 'critical',
        title: 'No email in the document',
        detail:
          'No email address in the resume text — most trackers key your record off the one they parse out of the document, not the one you type into the form.',
      },
    },
    {
      ok: PHONE_RE.test(text),
      suggestion: {
        id: 'no-phone',
        severity: 'important',
        title: 'No phone number in the document',
        detail: 'No phone number in the resume text.',
      },
    },
    {
      ok: sections >= 2,
      suggestion: {
        id: 'no-sections',
        severity: 'critical',
        title: 'Parsers can’t find your sections',
        detail:
          'Fewer than two standard section headings found. Parsers split a resume on “Experience”, “Education” and “Skills” — without them, everything lands in one undifferentiated blob.',
      },
    },
    {
      ok: DATE_RE.test(text),
      suggestion: {
        id: 'no-dates',
        severity: 'important',
        title: 'No employment dates found',
        detail:
          'No dates were found in the resume text. Trackers compute your years of experience from the dates beside each role — with none, that calculation comes out at zero however long you have worked.',
      },
    },
    {
      ok: !singleBlob,
      suggestion: {
        id: 'single-blob',
        severity: 'important',
        title: 'Layout extracts as one block',
        detail:
          'The whole resume came out as one unbroken run of text, which is what a two-column or table-based layout does to a parser. A single-column layout reads back in the order you wrote it.',
      },
    },
    {
      ok: noiseRatio < 0.02,
      suggestion: {
        id: 'extraction-noise',
        severity: 'important',
        title: 'The PDF’s text layer is damaged',
        detail:
          'The extracted text carries a lot of unmappable characters, which usually means the PDF’s fonts aren’t embedded properly. Re-export it — "Save as PDF" from your editor rather than printing to PDF — or a tracker will read the same gibberish.',
      },
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
    suggestions: checks.filter((check) => !check.ok).map((check) => check.suggestion),
  }
}

/**
 * Requirements that are screened as a yes/no rather than ranked.
 *
 * These are the ones that get an application rejected outright while the
 * keyword score looks healthy, which is exactly the failure a keyword-only
 * view can't explain. Each is detected in the posting *and* evidenced against
 * the candidate, and a requirement the posting never states is never counted.
 *
 * `demand` is deliberately narrow. A posting that merely uses the word
 * "French" is not asking for French; one that says "fluent French" is.
 */
const HARD_REQUIREMENTS: Array<{
  id: string
  label: string
  demand: RegExp
  evidence: RegExp
  advice: string
}> = [
  {
    id: 'degree',
    label: 'a degree',
    demand:
      /\b(bachelor'?s?|master'?s?|b\.?sc|m\.?sc|phd|doctorate|degree required|licence|dipl[oô]me|bac\s*\+\s*[35])\b/i,
    evidence: /\b(bachelor|master|b\.?sc|m\.?sc|phd|doctorate|degree|licence|dipl[oô]me|university|universit[ée]|ing[ée]nieur|bac\s*\+)\b/i,
    advice:
      'The posting names a degree. Make sure your Education section spells out the qualification and the institution — a parser that finds no degree records none.',
  },
  {
    id: 'french',
    label: 'French',
    demand: /\b(fluent|native|courant|bilingue|bilingual|professional)\s+(in\s+)?(french|fran[çc]ais)\b|\bfrench\s+(is\s+)?(required|mandatory|essential)\b|\bfran[çc]ais\s+courant\b/i,
    evidence: /\b(french|fran[çc]ais)\b/i,
    advice:
      'The posting asks for French. Add it to Profile → Languages with the level, and name it on the resume itself — the tracker reads the document, not the form.',
  },
  {
    id: 'english',
    label: 'English',
    demand: /\b(fluent|native|professional|business)\s+english\b|\benglish\s+(is\s+)?(required|mandatory|essential)\b|\banglais\s+courant\b/i,
    evidence: /\b(english|anglais|toeic|toefl|ielts)\b/i,
    advice:
      'The posting asks for English. Say so explicitly in a Languages line — a resume written in English is not the same as a resume that states an English level, and only one of those is parseable.',
  },
  {
    id: 'driving-licence',
    label: 'a driving licence',
    demand: /\b(driving licen[cs]e|driver'?s licen[cs]e|permis de conduire|permis b)\b/i,
    evidence: /\b(driving licen[cs]e|driver'?s licen[cs]e|permis de conduire|permis b)\b/i,
    advice:
      'The posting requires a driving licence. If you hold one, put it on the resume in as many words — this is screened as a yes/no.',
  },
  {
    id: 'work-authorisation',
    label: 'work authorisation',
    demand:
      /\b(work authorization|work authorisation|right to work|work permit|visa sponsorship is not|no sponsorship|must be eligible to work|titre de s[ée]jour|autorisation de travail)\b/i,
    evidence: /\b(citizen|nationality|work permit|right to work|visa|permanent resident|nationalit[ée]|ressortissant)\b/i,
    advice:
      'The posting screens on the right to work. If you already hold it, state it in one line — this is a filter, and an unstated answer reads the same as a no.',
  },
  {
    id: 'clearance',
    label: 'a security clearance',
    demand: /\b(security clearance|clearance required|habilitation d[ée]fense)\b/i,
    evidence: /\b(security clearance|clearance|habilitation)\b/i,
    advice:
      'The posting requires a security clearance. If you hold one, say so and give its level; if you do not, this is usually a hard filter and the application may not be worth the time.',
  },
]

function requirementsComponent(
  jobDescription: string,
  resumeText: string,
  profile: Profile,
): { component: AtsComponent; suggestions: AtsSuggestion[] } | null {
  const demanded = HARD_REQUIREMENTS.filter((entry) => entry.demand.test(jobDescription))
  if (!demanded.length) return null

  // The profile counts as evidence alongside the document, because a language
  // listed under Profile → Languages is a fact about the candidate even when
  // the uploaded PDF forgot to mention it. The suggestion still says to put it
  // in the document, since that is what gets parsed.
  const candidateText = [
    resumeText,
    profile.summary,
    profile.headline,
    profile.languages.join(' '),
    profile.skills.join(' '),
    ...profile.education.map((entry) => `${entry.school} ${entry.degree} ${entry.field}`),
  ].join('\n')

  const unmet = demanded.filter((entry) => !entry.evidence.test(candidateText))
  const met = demanded.length - unmet.length

  return {
    component: {
      id: 'requirements',
      label: 'Stated requirements',
      score: met / demanded.length,
      weight: WEIGHTS.requirements,
      detail:
        unmet.length === 0
          ? `Your resume evidences all ${demanded.length} of the posting's stated requirements.`
          : `Nothing in your resume evidences ${unmet.map((entry) => entry.label).join(', ')}.`,
    },
    suggestions: unmet.map((entry) => ({
      id: `requirement-${entry.id}`,
      severity: 'critical' as const,
      title: `Unevidenced requirement: ${entry.label}`,
      detail: entry.advice,
    })),
  }
}

export function scoreResumeAgainstJob(input: AtsInput): AtsScore {
  const keywords = extractJobKeywords(input.jobDescription)
  const index = candidateIndex(input)

  /*
   * What the *document* says, separately from what the profile knows.
   *
   * The gap between the two is the most actionable thing on the page: a term
   * in this gap needs nothing to become true, the resume just has to say
   * something already true of you. Telling someone to "add Kubernetes" when
   * they have listed Kubernetes as a skill is advice they can't act on.
   */
  const documentIndex = matchIndex(input.resumeText)

  const matched: string[] = []
  const missing: string[] = []
  const easyWins: string[] = []
  let matchedWeight = 0
  let totalWeight = 0

  for (const keyword of keywords) {
    totalWeight += keyword.weight
    if (containsTerm(index, keyword.term)) {
      matched.push(keyword.term)
      matchedWeight += keyword.weight
      if (!containsTerm(documentIndex, keyword.term)) easyWins.push(keyword.term)
    } else {
      missing.push(keyword.term)
    }
  }

  const components: AtsComponent[] = []
  const suggestions: AtsSuggestion[] = []

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

  const requirements = requirementsComponent(input.jobDescription, input.resumeText, input.profile)
  if (requirements) {
    components.push(requirements.component)
    suggestions.push(...requirements.suggestions)
  }

  /*
   * No document at all is a different thing from a badly-parsing one.
   *
   * Scoring "machine readability" against text that does not exist drags the
   * whole number down for a reason the user cannot act on from the score
   * itself — and it buries the keyword and title signal, which is computed
   * from the stored profile and is perfectly real. A 5/100 that means "you
   * have not uploaded a CV" reads as "you are a terrible match", and those
   * call for opposite responses.
   *
   * So: say it once, loudly, and score the components that can actually be
   * computed.
   */
  if (input.resumeText.trim().length < 50) {
    suggestions.push({
      id: 'no-resume',
      severity: 'critical',
      title: 'No CV text to score',
      detail:
        'There is no resume text stored, so only your profile could be scored. Applicant trackers read the document you upload, not a profile — upload a PDF or DOCX under Profile → Resume, or paste the text there, and score this again.',
    })
  } else {
    const parseability = parseabilityComponent(input.resumeText)
    components.push(parseability.component)
    suggestions.push(...parseability.suggestions)
  }

  if (easyWins.length) {
    suggestions.push({
      id: 'easy-wins',
      severity: 'important',
      title: 'Your profile says it; your resume doesn’t',
      detail: `${easyWins.slice(0, 8).join(', ')} — the posting wants these and your profile already claims them, but the resume text never says so. The tracker only reads the document. This is the cheapest gain on this page: nothing has to become true.`,
    })
  }

  if (missing.length) {
    suggestions.push({
      id: 'missing-terms',
      severity: 'important',
      title: 'Terms the posting uses that you never do',
      detail: `${missing.slice(0, 8).join(', ')}. Work in the ones you can say honestly — a keyword you can't back up in an interview costs more than it gains.`,
    })
  }

  if (title && title.score < 0.5) {
    suggestions.push({
      id: 'title-wording',
      severity: 'important',
      title: 'Your titles don’t read like the posting’s',
      detail: `Neither your headline nor any of your titles reads like “${input.jobTitle.trim()}”. Mirroring the posting's own title wording is one of the cheapest ranking gains there is.`,
    })
  }

  const seniorityGap = seniorityMismatch(input.jobTitle, input.profile)
  if (seniorityGap) suggestions.push(seniorityGap)

  if (required !== null && input.profile.yearsExperience < required) {
    suggestions.push({
      id: 'years-short',
      severity: 'critical',
      title: `Short of the ${required} years the posting screens for`,
      detail: `The posting screens for ${required} years of experience and your profile says ${input.profile.yearsExperience}. Filters on this are usually a floor, not a preference.`,
    })
  }

  const weightSum = components.reduce((sum, component) => sum + component.weight, 0)
  const weighted = components.reduce(
    (sum, component) => sum + component.score * component.weight,
    0,
  )

  const ranked = rankSuggestions(suggestions)

  return {
    score: weightSum ? Math.round((weighted / weightSum) * 100) : 0,
    components,
    matched,
    missing,
    easyWins,
    suggestions: ranked,
    // Kept so callers that render a flat list keep working unchanged.
    notes: ranked.map((suggestion) => suggestion.detail),
  }
}

const SEVERITY_ORDER: Record<AtsSeverity, number> = { critical: 0, important: 1, polish: 2 }

/**
 * Worst first, and stable within a severity so the same input always produces
 * the same list — a score that reshuffles itself between identical runs reads
 * as broken whatever the numbers say.
 */
function rankSuggestions(suggestions: AtsSuggestion[]): AtsSuggestion[] {
  return suggestions
    .map((suggestion, order) => ({ suggestion, order }))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.suggestion.severity] - SEVERITY_ORDER[b.suggestion.severity] ||
        a.order - b.order,
    )
    .map((entry) => entry.suggestion)
}

/**
 * A seniority gap between the posting and the candidate's own titles.
 *
 * Invisible to keyword overlap — "Junior Developer" and "Senior Developer"
 * share every meaningful word — and one of the things a human screener filters
 * on first. Only reported when *both* sides state a level, because inferring
 * seniority from silence is how you tell someone they're too junior for a job
 * whose title simply didn't say.
 */
function seniorityMismatch(jobTitle: string, profile: Profile): AtsSuggestion | null {
  const wanted = seniorityOf(jobTitle)
  if (!wanted) return null

  const held = seniorityOf(
    [profile.currentTitle, profile.headline, ...profile.experience.map((e) => e.title)].join(' '),
  )
  if (!held || held.rank === wanted.rank) return null

  if (held.rank < wanted.rank) {
    return {
      id: 'seniority-below',
      severity: 'important',
      title: `The posting says “${wanted.word}”, your titles say “${held.word}”`,
      detail: `This posting is pitched at "${wanted.word}" and the most senior wording in your own titles is "${held.word}". Keyword matching is blind to this, but a screener is not. If your scope genuinely matches, say so in the summary — team size, budget, what you owned.`,
    }
  }

  return {
    id: 'seniority-above',
    severity: 'polish',
    title: `You read as “${held.word}” for a “${wanted.word}” role`,
    detail: `Your titles read as "${held.word}" and the posting is pitched at "${wanted.word}". That is not a filter you fail, but it is the one that gets an application set aside as overqualified. Worth a line on why you want this particular role.`,
  }
}
