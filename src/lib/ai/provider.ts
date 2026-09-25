import type { FieldKind, JobRef, Profile } from '@/lib/schema'

/**
 * The seam between features and whichever model actually answers.
 *
 * Milestone 1 only needs `answerQuestion`, but the resume/cover-letter/ATS
 * features land behind this same interface, and a hosted backend could replace
 * the Gemini implementation without any feature code changing.
 */

export type AnswerQuestionInput = {
  question: string
  kind: FieldKind
  /** When non-empty, the reply must be one of these verbatim. */
  options: string[]
  profile: Profile
  job: JobRef | null
  jobDescription: string
}

export type AnswerQuestionResult = {
  answer: string
  confidence: number
  reasoning: string
}

export type ProviderModel = {
  id: string
  label: string
}

/**
 * What a resume-parse can hand back. Every field is optional — the model omits
 * whatever it didn't actually find rather than inventing a plausible-looking
 * value, and the merge step only ever fills profile fields that are still
 * empty, so a partial result is normal and safe.
 */
export type ParsedResume = {
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  phoneCountryCode?: string
  addressLine1?: string
  city?: string
  state?: string
  postalCode?: string
  country?: string
  linkedinUrl?: string
  portfolioUrl?: string
  githubUrl?: string
  headline?: string
  summary?: string
  currentTitle?: string
  currentCompany?: string
  yearsExperience?: number
  skills?: string[]
  languages?: string[]
  experience?: Array<{
    company: string
    title: string
    location: string
    startDate: string
    endDate: string
    current: boolean
    description: string
  }>
  education?: Array<{
    school: string
    degree: string
    field: string
    startYear: string
    endYear: string
    grade: string
  }>
}

export type GenerateCoverLetterInput = {
  profile: Profile
  job: JobRef | null
  /** Job description text scraped from the page, when available. */
  jobDescription: string
}

export type GenerateCoverLetterResult = {
  text: string
}

export type ReviewResumeInput = {
  resumeText: string
  profile: Profile
  jobTitle: string
  jobDescription: string
  /**
   * Terms the deterministic scorer found in the posting but not the resume.
   * Handed over so the review can speak to the same gaps the score reflects,
   * instead of the two halves of the feature disagreeing about what's wrong.
   */
  missingKeywords: string[]
}

/**
 * The judgement half of ATS scoring. Deliberately carries no number: the
 * score comes from `lib/ats.ts`, which computes it the same way twice, and a
 * model asked for one invents a plausible-looking figure instead.
 */
export type ResumeReview = {
  /** One sentence: would this resume survive the screen, and why. */
  verdict: string
  strengths: string[]
  gaps: string[]
  /** Concrete edits, each one something the candidate can honestly make. */
  suggestions: string[]
}

export type GenerateResumeInput = {
  profile: Profile
  /** The stored resume text, as extra ground truth for what actually happened. */
  resumeText: string
  jobTitle: string
  jobDescription: string
  /** Terms the ATS scorer found in the posting but not the resume. */
  missingKeywords: string[]
}

/**
 * A resume rewritten for one posting — wording only.
 *
 * `roles` identifies each role by its index in the profile's experience list
 * rather than by name, and the caller reattaches the real company, title and
 * dates afterwards. A model that hallucinates an employer therefore can't
 * get one onto the page: the worst it can do is write bullets for a role
 * index that doesn't exist, which is dropped.
 */
export type GeneratedResume = {
  summary: string
  skills: string[]
  roles: Array<{ index: number; bullets: string[] }>
  notes: string[]
}

export interface AIProvider {
  readonly name: string
  /** Models the supplied key can actually call, best-first. */
  listModels(): Promise<ProviderModel[]>
  answerQuestion(input: AnswerQuestionInput): Promise<AnswerQuestionResult>
  /** Turn raw resume text into structured profile fields. */
  parseResume(resumeText: string): Promise<ParsedResume>
  /** Write a cover letter tailored to a specific job from the candidate profile. */
  generateCoverLetter(input: GenerateCoverLetterInput): Promise<GenerateCoverLetterResult>
  /** Qualitative review of a resume against one posting. The score is computed separately. */
  reviewResume(input: ReviewResumeInput): Promise<ResumeReview>
  /** Rewrite the candidate's real experience to speak to one posting. */
  generateResume(input: GenerateResumeInput): Promise<GeneratedResume>
}

export class AIProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'AIProviderError'
  }

  /** Free tiers throttle aggressively; callers back off rather than fail the run. */
  get isRateLimit(): boolean {
    return this.status === 429
  }

  get isAuth(): boolean {
    return this.status === 401 || this.status === 403
  }
}

/**
 * A compact profile summary for prompt context. Deliberately excludes the
 * resume binary, contact details and demographics — none of it helps answer a
 * screening question, and it keeps what leaves the machine to a minimum.
 */
export function profileContext(profile: Profile): string {
  const lines: string[] = []

  if (profile.currentTitle) lines.push(`Current title: ${profile.currentTitle}`)
  if (profile.currentCompany) lines.push(`Current company: ${profile.currentCompany}`)
  lines.push(`Total years of professional experience: ${profile.yearsExperience}`)

  if (profile.skills.length) lines.push(`Skills: ${profile.skills.join(', ')}`)
  if (profile.languages.length) lines.push(`Languages: ${profile.languages.join(', ')}`)

  lines.push(`Authorized to work without sponsorship: ${profile.workAuthorized ? 'yes' : 'no'}`)
  lines.push(`Requires visa sponsorship: ${profile.requiresSponsorship ? 'yes' : 'no'}`)
  lines.push(`Willing to relocate: ${profile.willingToRelocate ? 'yes' : 'no'}`)
  lines.push(`Remote preference: ${profile.remotePreference}`)
  lines.push(
    `Notice period: ${profile.noticePeriodWeeks === 0 ? 'immediate' : `${profile.noticePeriodWeeks} weeks`}`,
  )
  if (profile.desiredSalary) {
    lines.push(`Desired compensation: ${profile.desiredSalary} ${profile.salaryCurrency}`)
  }

  const roles = profile.experience.slice(0, 6).map((e) => {
    const span = `${e.startDate || '?'} – ${e.current ? 'present' : e.endDate || '?'}`
    return `- ${e.title || 'Role'} at ${e.company || 'Company'} (${span})`
  })
  if (roles.length) lines.push('Experience:', ...roles)

  const schools = profile.education.slice(0, 3).map((e) => {
    const degree = [e.degree, e.field].filter(Boolean).join(' in ')
    return `- ${degree || 'Studied'} at ${e.school || 'Institution'}${e.endYear ? ` (${e.endYear})` : ''}`
  })
  if (schools.length) lines.push('Education:', ...schools)

  if (profile.summary) lines.push(`Summary: ${profile.summary}`)

  return lines.join('\n')
}
