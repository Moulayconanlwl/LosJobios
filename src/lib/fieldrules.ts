import type { FieldKind, Profile } from './schema'

/**
 * The field-semantics rule table, kept free of any DOM dependency so the
 * background service worker can classify a question string on its own — the
 * content script has an element to inspect, the answer resolver only ever has
 * text.
 */

/**
 * Below this, an answer isn't trusted enough to go into a *required* field —
 * the run pauses and asks instead. Lives here rather than beside the resolver
 * so the content script can read it without pulling in the AI stack.
 */
export const CONFIDENCE_FLOOR = 0.6

/** Semantic slots a field can map onto in the stored profile. */
export type ProfileKey =
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'email'
  | 'phone'
  | 'phoneCountryCode'
  | 'addressLine1'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'country'
  | 'linkedinUrl'
  | 'portfolioUrl'
  | 'githubUrl'
  | 'currentCompany'
  | 'currentTitle'
  | 'headline'
  | 'summary'
  | 'yearsExperience'
  | 'desiredSalary'
  | 'noticePeriod'
  | 'workAuthorized'
  | 'requiresSponsorship'
  | 'willingToRelocate'
  | 'school'
  | 'degree'
  | 'resume'
  | 'coverLetter'
  | 'gender'
  | 'ethnicity'
  | 'veteranStatus'
  | 'disabilityStatus'

type Rule = {
  key: ProfileKey
  /** Any match promotes the field. */
  patterns: RegExp[]
  /** Any match disqualifies it, even if a pattern hit. */
  exclude?: RegExp[]
  /** HTML autocomplete tokens, which are an unusually trustworthy signal. */
  autocomplete?: string[]
  /** Restrict to these control kinds when the slot only makes sense for them. */
  kinds?: FieldKind[]
}

/**
 * Ordered most-specific first. Classification returns on the first rule that
 * matches, so moving a line up or down changes behaviour. "first name" must be
 * tested before the broader "name", or every field becomes a full-name field.
 */
const RULES: Rule[] = [
  {
    key: 'firstName',
    patterns: [/\bfirst\s*name\b/, /\bgiven\s*name\b/, /\bforename\b/, /\bfname\b/],
    autocomplete: ['given-name'],
  },
  {
    key: 'lastName',
    patterns: [/\blast\s*name\b/, /\bfamily\s*name\b/, /\bsurname\b/, /\blname\b/],
    autocomplete: ['family-name'],
  },
  {
    key: 'phoneCountryCode',
    patterns: [/country\s*code/, /phone\s*country/, /dial\s*code/],
  },
  {
    key: 'email',
    patterns: [/\be-?mail\b/],
    exclude: [/confirm/, /verify/, /re-?enter/],
    autocomplete: ['email'],
  },
  {
    key: 'phone',
    patterns: [/\bphone\b/, /\bmobile\b/, /\btelephone\b/, /\bcell\b/, /\bcontact number\b/],
    exclude: [/country/, /extension\b/, /\bext\b/, /\bcode\b/],
    autocomplete: ['tel', 'tel-national'],
  },
  {
    key: 'linkedinUrl',
    patterns: [/linked\s*in/],
  },
  {
    key: 'githubUrl',
    patterns: [/\bgithub\b/, /\bgit hub\b/],
  },
  {
    key: 'portfolioUrl',
    patterns: [
      /portfolio/,
      /personal\s*(web)?site/,
      /\bwebsite\b/,
      /\bblog\b/,
      /dribbble/,
      /behance/,
    ],
  },
  {
    key: 'postalCode',
    patterns: [/\bzip\b/, /\bpostal\s*code\b/, /\bpostcode\b/, /\bpin\s*code\b/],
    autocomplete: ['postal-code'],
  },
  {
    key: 'city',
    patterns: [/\bcity\b/, /\btown\b/, /\blocality\b/],
    exclude: [/citizen/],
    autocomplete: ['address-level2'],
  },
  {
    key: 'state',
    patterns: [/\bstate\b/, /\bprovince\b/, /\bregion\b/, /\bcounty\b/],
    exclude: [/united states/, /statement/, /veteran/, /disabilit/],
    autocomplete: ['address-level1'],
  },
  {
    key: 'country',
    patterns: [/\bcountry\b/, /\bnation\b/],
    exclude: [/code/, /citizenship/],
    autocomplete: ['country', 'country-name'],
  },
  {
    key: 'addressLine1',
    patterns: [/\bstreet\b/, /address\s*(line)?\s*1?\b/, /\bmailing address\b/],
    exclude: [/e-?mail/, /\bcity\b/, /\bstate\b/, /\bzip\b/, /postal/, /\bcountry\b/],
    autocomplete: ['street-address', 'address-line1'],
  },
  {
    key: 'requiresSponsorship',
    patterns: [
      /sponsorship/,
      /require.*visa/,
      /visa.*(support|sponsor)/,
      /will you (now|in the future).*require/,
      /h-?1b/,
    ],
  },
  {
    key: 'workAuthorized',
    patterns: [
      /legally (authorized|entitled|eligible)/,
      /authorized to work/,
      /right to work/,
      /work permit/,
      /eligible to work/,
      /work authori[sz]ation/,
    ],
  },
  {
    key: 'willingToRelocate',
    patterns: [/relocat/, /willing to move/],
  },
  {
    key: 'yearsExperience',
    patterns: [
      /years? of (professional |relevant |work |total )?experience/,
      /how many years/,
      /years? experience/,
      /experience \(years\)/,
    ],
  },
  {
    key: 'desiredSalary',
    patterns: [
      /salary/,
      /compensation/,
      /expected pay/,
      /desired (pay|rate)/,
      /hourly rate/,
      /day rate/,
    ],
  },
  {
    key: 'noticePeriod',
    patterns: [
      /notice period/,
      /how soon can you (start|join)/,
      /availability to start/,
      /start date/,
      /earliest.*start/,
    ],
  },
  {
    key: 'currentCompany',
    patterns: [/current (employer|company|organization)/, /\bemployer\b/, /present company/],
    autocomplete: ['organization'],
  },
  {
    key: 'currentTitle',
    patterns: [/current (job )?title/, /current (role|position)/, /\bjob title\b/, /your title/],
    autocomplete: ['organization-title'],
  },
  {
    key: 'school',
    patterns: [/\bschool\b/, /\buniversity\b/, /\bcollege\b/, /institution/, /alma mater/],
  },
  {
    key: 'degree',
    patterns: [/\bdegree\b/, /qualification/, /education level/, /highest level of education/],
  },
  {
    key: 'resume',
    patterns: [/\bresume\b/, /\bcv\b/, /curriculum vitae/],
    kinds: ['file'],
  },
  {
    // Deliberately narrow: a field that actually asks for a letter. "Why are
    // you interested in this role?" is a short-answer question, and sending it
    // down this path answers it with a full cover letter, sign-off and all.
    // The resolver's ordinary free-text tier gives it the right shape.
    key: 'coverLetter',
    patterns: [/cover\s*letter/, /motivation letter/, /letter of (interest|motivation)/],
  },
  {
    key: 'gender',
    patterns: [/\bgender\b/, /\bsex\b/],
  },
  {
    key: 'ethnicity',
    patterns: [/ethnic/, /\brace\b/, /racial/, /hispanic or latino/],
  },
  {
    key: 'veteranStatus',
    patterns: [/veteran/, /military service/, /protected veteran/],
  },
  {
    key: 'disabilityStatus',
    patterns: [/disabilit/, /\bdisabled\b/, /section 503/],
  },
  {
    key: 'headline',
    patterns: [/headline/, /professional summary/, /about you/, /\btagline\b/],
  },
  {
    key: 'summary',
    patterns: [/\bsummary\b/, /tell us about yourself/, /\bbio\b/, /introduce yourself/],
  },
  {
    key: 'fullName',
    patterns: [/\bfull\s*name\b/, /\byour name\b/, /^name$/, /\bname\b/],
    exclude: [
      /first/,
      /last/,
      /middle/,
      /user/,
      /company/,
      /school/,
      /file/,
      /nickname/,
      /preferred/,
    ],
    autocomplete: ['name'],
  },
]

export type ClassifySignals = {
  /** The question as a human reads it. */
  label: string
  /** name / id / placeholder / data-* attributes, joined. Optional. */
  attributes?: string
  /** The HTML autocomplete token, if any. */
  autocomplete?: string
  kind: FieldKind
}

export type Classification = {
  key: ProfileKey | null
  confidence: number
}

/** Lowercase, split camelCase and snake_case, collapse whitespace. */
export function flatten(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Score signals against the rule table.
 *
 * Confidence reflects which signal fired: an explicit `autocomplete` token is
 * near-certain, a label match is strong, an attribute-only match is weaker
 * because generated `name` attributes throw false positives.
 */
export function classifySignals({
  label,
  attributes = '',
  autocomplete = '',
  kind,
}: ClassifySignals): Classification {
  const labelHay = flatten(label)
  const attrHay = flatten(attributes)
  const tokens = autocomplete.toLowerCase().split(/\s+/).filter(Boolean)

  for (const rule of RULES) {
    if (rule.kinds && !rule.kinds.includes(kind)) continue

    if (rule.autocomplete?.some((token) => tokens.includes(token))) {
      return { key: rule.key, confidence: 0.98 }
    }

    if (rule.exclude?.some((re) => re.test(labelHay) || re.test(attrHay))) continue

    if (rule.patterns.some((re) => re.test(labelHay))) {
      return { key: rule.key, confidence: 0.9 }
    }
    if (attrHay && rule.patterns.some((re) => re.test(attrHay))) {
      return { key: rule.key, confidence: 0.65 }
    }
  }

  return { key: null, confidence: 0 }
}

/** Canonical form used as the answer-bank lookup key. */
export function normalizeQuestion(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The value to put in a field, given the stored profile. Booleans come back as
 * "Yes"/"No" so option matching can map them onto whatever phrasing the page
 * uses. Returns null when the profile has nothing for that slot.
 */
export function valueForKey(key: ProfileKey, profile: Profile): string | null {
  const nonEmpty = (value: string) => (value.trim() ? value.trim() : null)

  switch (key) {
    case 'firstName':
      return nonEmpty(profile.firstName)
    case 'lastName':
      return nonEmpty(profile.lastName)
    case 'fullName':
      return nonEmpty(`${profile.firstName} ${profile.lastName}`)
    case 'email':
      return nonEmpty(profile.email)
    case 'phone':
      return nonEmpty(profile.phone)
    case 'phoneCountryCode':
      return nonEmpty(profile.phoneCountryCode)
    case 'addressLine1':
      return nonEmpty(profile.addressLine1)
    case 'city':
      return nonEmpty(profile.city)
    case 'state':
      return nonEmpty(profile.state)
    case 'postalCode':
      return nonEmpty(profile.postalCode)
    case 'country':
      return nonEmpty(profile.country)
    case 'linkedinUrl':
      return nonEmpty(profile.linkedinUrl)
    case 'portfolioUrl':
      return nonEmpty(profile.portfolioUrl)
    case 'githubUrl':
      return nonEmpty(profile.githubUrl)
    case 'currentCompany':
      return nonEmpty(profile.currentCompany)
    case 'currentTitle':
      return nonEmpty(profile.currentTitle)
    case 'headline':
      return nonEmpty(profile.headline)
    case 'summary':
      return nonEmpty(profile.summary)
    case 'yearsExperience':
      return String(profile.yearsExperience)
    case 'desiredSalary':
      return nonEmpty(profile.desiredSalary)
    case 'noticePeriod':
      return profile.noticePeriodWeeks === 0 ? 'Immediately' : `${profile.noticePeriodWeeks} weeks`
    case 'workAuthorized':
      return profile.workAuthorized ? 'Yes' : 'No'
    case 'requiresSponsorship':
      return profile.requiresSponsorship ? 'Yes' : 'No'
    case 'willingToRelocate':
      return profile.willingToRelocate ? 'Yes' : 'No'
    case 'school':
      return nonEmpty(profile.education[0]?.school ?? '')
    case 'degree':
      return nonEmpty(profile.education[0]?.degree ?? '')
    case 'coverLetter':
      return nonEmpty(profile.coverLetterTemplate)
    case 'gender':
      return nonEmpty(profile.voluntaryDisclosure.gender)
    case 'ethnicity':
      return nonEmpty(profile.voluntaryDisclosure.ethnicity)
    case 'veteranStatus':
      return nonEmpty(profile.voluntaryDisclosure.veteranStatus)
    case 'disabilityStatus':
      return nonEmpty(profile.voluntaryDisclosure.disabilityStatus)
    case 'resume':
      // Handled by file attachment, not by a string value.
      return null
    default:
      return null
  }
}
