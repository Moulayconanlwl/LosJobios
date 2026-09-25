import {
  AIProviderError,
  profileContext,
  type AIProvider,
  type AnswerQuestionInput,
  type AnswerQuestionResult,
  type GenerateCoverLetterInput,
  type GenerateCoverLetterResult,
  type ParsedResume,
  type ProviderModel,
  type ResumeReview,
  type ReviewResumeInput,
} from './provider'

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta'

export const GEMINI_HOST_PERMISSION = 'https://generativelanguage.googleapis.com/*'

/**
 * Gemini via plain `fetch`.
 *
 * No SDK on purpose: the official client pulls in Node shims that don't survive
 * an MV3 service worker, and the REST surface we need here is two endpoints.
 */

type ListModelsResponse = {
  models?: Array<{
    name?: string
    displayName?: string
    supportedGenerationMethods?: string[]
  }>
}

type GenerateResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
}

/**
 * Rank a model id for our use: newest first, and cheapest-fastest tier first
 * within a version. Screening questions are short and highly constrained, so a
 * Flash-Lite class model is both sufficient and the most generous on free-tier
 * quota.
 */
export function scoreModel(id: string): number {
  const lower = id.toLowerCase()

  // Wrong modality or purpose — never usable for this.
  if (/embedding|aqa|imagen|veo|tts|image-generation|native-audio|live-/.test(lower)) return -1

  const version = Number(/gemini-(\d+(?:\.\d+)?)/.exec(lower)?.[1] ?? 0)

  let tier = 0
  if (lower.includes('flash-lite')) tier = 3
  else if (lower.includes('flash')) tier = 2
  else if (lower.includes('pro')) tier = 1

  // Prefer generally-available builds over experimental ones, which get
  // deprecated without warning.
  const stability = /preview|exp|experimental/.test(lower) ? -0.5 : 0

  return version * 10 + tier + stability
}

function extractText(body: GenerateResponse): string {
  const parts = body.candidates?.[0]?.content?.parts
  if (!parts?.length) return ''
  return parts
    .map((p) => p.text ?? '')
    .join('')
    .trim()
}

/**
 * Close every object/array a JSON fragment left open, so a response that
 * generation cut off cleanly *between* tokens can be handed to `JSON.parse`.
 *
 * Reports `hadOpenString` when the cutoff landed *inside* a string value —
 * closing that with a synthesized quote would produce syntactically valid
 * JSON, but the string itself is truncated (a job title cut off as "Staff
 * Eng" instead of "Staff Engineer"). Callers use the flag to refuse that
 * result rather than let a mangled value slip into the parsed output — the
 * same "don't keep a maybe-wrong value" rule the rest of this file follows
 * for confidence scoring.
 */
function closeOpenStructures(fragment: string): { text: string; hadOpenString: boolean } {
  let inString = false
  let escapeNext = false
  const stack: Array<'}' | ']'> = []

  for (const ch of fragment) {
    if (inString) {
      if (escapeNext) escapeNext = false
      else if (ch === '\\') escapeNext = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') stack.push('}')
    else if (ch === '[') stack.push(']')
    else if (ch === '}' || ch === ']') stack.pop()
  }

  const hadOpenString = inString
  let text = fragment
  if (inString) text += '"'
  while (stack.length) text += stack.pop()
  return { text, hadOpenString }
}

/**
 * The furthest point in `text` that's safe to truncate at and still close
 * cleanly — right after a comma, an opening bracket, or a complete nested
 * structure, and never inside a string or leaving a trailing comma behind.
 *
 * Deliberately does *not* treat "a string just closed" as safe on its own:
 * that string might be a property key awaiting its colon and value, and
 * truncating right after a bare key produces invalid JSON. A string that
 * really was a complete *value* is always immediately followed by a comma
 * or a closing bracket in valid JSON, which the other two rules already
 * catch — so this covers every genuinely safe point without that false one.
 * Tracks string state throughout so a comma inside an already-complete
 * field's text ("Built APIs, dashboards, …") is never mistaken for a
 * structural one.
 */
function lastSafeBoundary(text: string): number {
  let inString = false
  let escapeNext = false
  let safe = -1

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escapeNext) escapeNext = false
      else if (ch === '\\') escapeNext = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === ',') safe = i // exclude the comma — JSON doesn't allow a trailing one
    else if (ch === '{' || ch === '[' || ch === '}' || ch === ']') safe = i + 1
  }

  return safe
}

function tryParseObject(candidate: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(candidate)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Pull a JSON object out of a reply, tolerating markdown fences and — this is
 * the part that matters — a response generation cut off partway through.
 * `maxOutputTokens` is a hard ceiling, and a model that spends part of its
 * budget on internal reasoning before ever emitting JSON can still run out
 * mid-array on a resume with several jobs. Rather than discarding the whole
 * result over one dangling field, this rolls back to the last cleanly
 * complete element and closes whatever structure was left open around it —
 * salvaging everything that finished generating, and never a truncated value.
 */
export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  const start = cleaned.indexOf('{')
  if (start < 0) return null

  const body = cleaned.slice(start)

  // The common case: a complete response, closed exactly at its last brace.
  const end = body.lastIndexOf('}')
  if (end > 0) {
    const exact = tryParseObject(body.slice(0, end + 1))
    if (exact) return exact
  }

  // Truncated: roll back to the last point that closes without a dangling
  // string, then close whatever's left open. A handful of attempts is
  // plenty — lastSafeBoundary finds the correct point directly rather than
  // guessing, so this rarely needs more than one retry.
  let candidate = body
  for (let attempt = 0; attempt < 6 && candidate.length > 1; attempt += 1) {
    const { text, hadOpenString } = closeOpenStructures(candidate)
    if (!hadOpenString) {
      const parsed = tryParseObject(text)
      if (parsed) return parsed
    }

    const boundary = lastSafeBoundary(candidate)
    if (boundary <= 0 || boundary >= candidate.length) break
    candidate = candidate.slice(0, boundary)
  }

  return null
}

const SYSTEM_PROMPT = `You fill in job application forms on behalf of a candidate.

Rules, in priority order:
1. Answer strictly from the candidate profile you are given. Never invent experience, credentials, dates, or employers.
2. If the question offers a list of allowed options, your answer MUST be exactly one of them, copied verbatim.
3. Numeric questions ("how many years of X") get a bare number, no units or words.
4. Yes/no questions get exactly "Yes" or "No".
5. Free-text questions get a concise, specific, first-person answer of at most 120 words. No greetings, no sign-off, no filler.
6. Set confidence honestly. If the profile does not actually contain what is being asked, set confidence below 0.5 rather than guessing — a human will be asked instead.

Reply with JSON only.`

const RESUME_SYSTEM_PROMPT = `You extract structured data from a candidate's resume text on their own behalf, so it can pre-fill a job application form for them.

Rules, in priority order:
1. Only report a field if the resume text actually contains it. Omit a field entirely rather than guessing or inventing a plausible value — an empty field left for the candidate to fill in themselves is fine; a wrong one is not.
2. Never fabricate employers, titles, dates, schools or credentials that aren't in the text.
3. Hyperlinks are rendered inline as "visible text (https://target)" — e.g. an icon or the word "LinkedIn" linking to a profile shows up as "LinkedIn (https://linkedin.com/in/…)". Pull the URL out into the right field (linkedinUrl / githubUrl / portfolioUrl) and don't leave the "(https://…)" fragment sitting in headline, summary, or any other text field.
4. Dates are free text exactly as the resume states them (e.g. "2021", "Mar 2021", "2021-03") — do not normalize or invent a day.
5. yearsExperience is your best total estimate of professional (post-graduation) experience in whole years, from the work history dates. Omit it if the history doesn't support a confident estimate.
6. List every distinct role in experience and every distinct program in education, most recent first. Keep each description to at most 2 sentences, drawn only from what's written.
7. skills and languages are short, distinct items — split a comma or bullet list rather than copying a whole sentence as one skill.

Reply with JSON only.`

const COVER_LETTER_SYSTEM_PROMPT = `You write a cover letter for a job candidate, from their profile and the job they're applying to.

Rules, in priority order:
1. Use only what's in the candidate profile. Never invent employers, titles, dates, credentials, or achievements that aren't there.
2. Open by naming the role and why the candidate is a fit, in one or two sentences — skip "I am writing to apply for..." filler.
3. Ground the middle in two or three concrete points from the candidate's actual experience that match what the job is asking for. If a job description is given, speak to it directly; if not, write from the profile alone without inventing a company name or role details.
4. Close with a short, direct line inviting next steps. No clichés like "I look forward to hearing from you soon."
5. If a style reference is given, match its tone and structure, but write entirely fresh content for this role — never copy its sentences verbatim.
6. Plain prose only: no markdown, no bullet points, no subject line, no placeholders like "[Company Name]" — write around anything you don't know rather than leaving a blank.
7. 250–400 words, first person, professional but not stiff. Sign off with the candidate's first name only.

Reply with the letter text only — no commentary, no JSON.`

const REVIEW_SYSTEM_PROMPT = `You review one candidate's resume against one job posting, for the candidate's own benefit, and say what to change.

Rules, in priority order:
1. Judge only what's in the resume and profile you're given. Never assume experience that isn't written down, and never suggest the candidate claim any.
2. Every suggestion must be an edit the candidate could honestly make today — rephrasing real work, surfacing something buried, mirroring the posting's wording for a skill they actually have. Never "get a certification" or "gain experience in X".
3. Be specific and name things. "Your Kubernetes work is buried in the third bullet of the Acme role — move it up" beats "highlight relevant skills".
4. A gap is something the posting asks for that the resume genuinely doesn't show. Say so plainly rather than softening it; the candidate needs to know where they stand.
5. No score, no rating, no percentage — that is computed elsewhere and yours would contradict it.
6. At most four items per list, each one sentence. Skip a list entirely rather than padding it.

Reply with JSON only.`

/** Gemini's structured-output schema format, not JSON Schema — types are UPPERCASE. */
const EXPERIENCE_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    company: { type: 'STRING' },
    title: { type: 'STRING' },
    location: { type: 'STRING' },
    startDate: { type: 'STRING' },
    endDate: { type: 'STRING' },
    current: { type: 'BOOLEAN' },
    description: { type: 'STRING' },
  },
}

const EDUCATION_ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    school: { type: 'STRING' },
    degree: { type: 'STRING' },
    field: { type: 'STRING' },
    startYear: { type: 'STRING' },
    endYear: { type: 'STRING' },
    grade: { type: 'STRING' },
  },
}

/**
 * Split from the summary fields on purpose. A single shared token budget
 * meant every field — including the often multi-entry experience/education
 * arrays — competed for the same `maxOutputTokens`, and a resume with several
 * jobs routinely got cut off before generation ever reached them. Giving
 * history its own call means its budget is spent entirely on history.
 */
const SUMMARY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    firstName: { type: 'STRING' },
    lastName: { type: 'STRING' },
    email: { type: 'STRING' },
    phone: { type: 'STRING' },
    phoneCountryCode: { type: 'STRING' },
    addressLine1: { type: 'STRING' },
    city: { type: 'STRING' },
    state: { type: 'STRING' },
    postalCode: { type: 'STRING' },
    country: { type: 'STRING' },
    linkedinUrl: { type: 'STRING' },
    portfolioUrl: { type: 'STRING' },
    githubUrl: { type: 'STRING' },
    headline: { type: 'STRING' },
    summary: { type: 'STRING' },
    currentTitle: { type: 'STRING' },
    currentCompany: { type: 'STRING' },
    yearsExperience: { type: 'NUMBER' },
    skills: { type: 'ARRAY', items: { type: 'STRING' } },
    languages: { type: 'ARRAY', items: { type: 'STRING' } },
  },
}

const HISTORY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    experience: { type: 'ARRAY', items: EXPERIENCE_ITEM_SCHEMA },
    education: { type: 'ARRAY', items: EDUCATION_ITEM_SCHEMA },
  },
}

const RESUME_STRING_FIELDS = [
  'firstName', 'lastName', 'email', 'phone', 'phoneCountryCode', 'addressLine1',
  'city', 'state', 'postalCode', 'country', 'linkedinUrl', 'portfolioUrl',
  'githubUrl', 'headline', 'summary', 'currentTitle', 'currentCompany',
] as const

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(asString).filter(Boolean)
}

function parseExperience(value: unknown): NonNullable<ParsedResume['experience']> {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      company: asString(item['company']),
      title: asString(item['title']),
      location: asString(item['location']),
      startDate: asString(item['startDate']),
      endDate: asString(item['endDate']),
      current: item['current'] === true,
      description: asString(item['description']),
    }))
    .filter((entry) => entry.company || entry.title)
}

function parseEducation(value: unknown): NonNullable<ParsedResume['education']> {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      school: asString(item['school']),
      degree: asString(item['degree']),
      field: asString(item['field']),
      startYear: asString(item['startYear']),
      endYear: asString(item['endYear']),
      grade: asString(item['grade']),
    }))
    .filter((entry) => entry.school)
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini'

  constructor(
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  private headers(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.apiKey,
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.apiKey) throw new AIProviderError('No Gemini API key configured.')

    let response: Response
    try {
      response = await fetch(`${API_ROOT}${path}`, { ...init, headers: this.headers() })
    } catch (err) {
      // Almost always a missing optional host permission or an offline machine.
      throw new AIProviderError(
        `Could not reach the Gemini API: ${err instanceof Error ? err.message : String(err)}`,
      )
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      const error = parseJsonObject(detail)?.['error'] as { message?: string } | undefined
      const message = error?.message ?? response.statusText
      throw new AIProviderError(`Gemini ${response.status}: ${message}`, response.status)
    }

    return (await response.json()) as T
  }

  /**
   * Ask the API what this key can actually call, rather than trusting a model
   * id baked in at build time. Gemini's lineup turns over quickly and a
   * hardcoded id becomes a 404 the moment it's retired.
   */
  async listModels(): Promise<ProviderModel[]> {
    const body = await this.request<ListModelsResponse>('/models')

    return (body.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => ({
        id: (m.name ?? '').replace(/^models\//, ''),
        label: m.displayName ?? (m.name ?? '').replace(/^models\//, ''),
      }))
      .filter((m) => m.id && scoreModel(m.id) >= 0)
      .sort((a, b) => scoreModel(b.id) - scoreModel(a.id))
  }

  async answerQuestion(input: AnswerQuestionInput): Promise<AnswerQuestionResult> {
    if (!this.model) throw new AIProviderError('No Gemini model selected.')

    const sections = [
      '## Candidate profile',
      profileContext(input.profile),
      '',
      '## Role',
      input.job
        ? `${input.job.title || 'Unknown title'} at ${input.job.company || 'Unknown company'}${
            input.job.location ? ` (${input.job.location})` : ''
          }`
        : 'Not specified.',
    ]

    if (input.jobDescription.trim()) {
      sections.push('', '## Job description', input.jobDescription.slice(0, 6000))
    }

    sections.push('', '## Question', input.question, `Input type: ${input.kind}`)

    if (input.options.length) {
      sections.push(
        '',
        '## Allowed options — answer with exactly one of these, copied verbatim',
        ...input.options.map((o) => `- ${o}`),
      )
    }

    const body = await this.request<GenerateResponse>(
      `/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: sections.join('\n') }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 800,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                answer: { type: 'STRING' },
                confidence: { type: 'NUMBER' },
                reasoning: { type: 'STRING' },
              },
              required: ['answer', 'confidence'],
            },
          },
        }),
      },
    )

    if (body.promptFeedback?.blockReason) {
      throw new AIProviderError(`Gemini blocked the prompt: ${body.promptFeedback.blockReason}`)
    }

    const parsed = parseJsonObject(extractText(body))
    if (!parsed || typeof parsed['answer'] !== 'string') {
      throw new AIProviderError('Gemini returned an unparseable answer.')
    }

    const rawConfidence = Number(parsed['confidence'])
    return {
      answer: parsed['answer'].trim(),
      confidence: Number.isFinite(rawConfidence) ? Math.min(Math.max(rawConfidence, 0), 1) : 0.5,
      reasoning: typeof parsed['reasoning'] === 'string' ? parsed['reasoning'] : '',
    }
  }

  /** One `generateContent` call constrained to a resume-parsing schema. */
  private async generateResumeJson(
    schema: object,
    maxOutputTokens: number,
    text: string,
  ): Promise<Record<string, unknown> | null> {
    const body = await this.request<GenerateResponse>(
      `/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: RESUME_SYSTEM_PROMPT }] },
          // Resumes run long; cap well above a typical one or two pages of text
          // while staying comfortably inside a free-tier context window.
          contents: [{ role: 'user', parts: [{ text: text.slice(0, 20_000) }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens,
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        }),
      },
    )

    if (body.promptFeedback?.blockReason) {
      throw new AIProviderError(`Gemini blocked the prompt: ${body.promptFeedback.blockReason}`)
    }

    return parseJsonObject(extractText(body))
  }

  async parseResume(resumeText: string): Promise<ParsedResume> {
    if (!this.model) throw new AIProviderError('No Gemini model selected.')

    const text = resumeText.trim()
    if (!text) throw new AIProviderError('No resume text to parse.')

    // Two independent calls, run together. Splitting keeps a long work
    // history from ever competing with the rest of the profile for the same
    // token budget, and running them with allSettled means a rate limit or a
    // truncation on one side doesn't cost the other its result — a resume
    // parse that gets contact details but misses education is still a much
    // better outcome than one that gets nothing at all.
    const [summaryResult, historyResult] = await Promise.allSettled([
      this.generateResumeJson(SUMMARY_SCHEMA, 3000, text),
      this.generateResumeJson(HISTORY_SCHEMA, 6000, text),
    ])

    if (summaryResult.status === 'rejected' && historyResult.status === 'rejected') {
      const reason = summaryResult.reason
      throw reason instanceof Error ? reason : new AIProviderError('Gemini resume parsing failed.')
    }

    const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : null
    const history = historyResult.status === 'fulfilled' ? historyResult.value : null

    if (!summary && !history) {
      throw new AIProviderError('Gemini returned an unparseable resume.')
    }

    const result: ParsedResume = {}

    if (summary) {
      for (const field of RESUME_STRING_FIELDS) {
        const value = asString(summary[field])
        if (value) result[field] = value
      }

      const years = Number(summary['yearsExperience'])
      if (Number.isFinite(years) && years >= 0) result.yearsExperience = Math.round(years)

      const skills = asStringArray(summary['skills'])
      if (skills.length) result.skills = skills

      const languages = asStringArray(summary['languages'])
      if (languages.length) result.languages = languages
    }

    if (history) {
      const experience = parseExperience(history['experience'])
      if (experience.length) result.experience = experience

      const education = parseEducation(history['education'])
      if (education.length) result.education = education
    }

    return result
  }

  async generateCoverLetter(input: GenerateCoverLetterInput): Promise<GenerateCoverLetterResult> {
    if (!this.model) throw new AIProviderError('No Gemini model selected.')

    const sections = [
      '## Candidate profile',
      profileContext(input.profile),
      '',
      '## Role',
      input.job
        ? `${input.job.title || 'Unknown title'} at ${input.job.company || 'Unknown company'}${
            input.job.location ? ` (${input.job.location})` : ''
          }`
        : 'Not specified.',
    ]

    if (input.jobDescription.trim()) {
      sections.push('', '## Job description', input.jobDescription.slice(0, 6000))
    }

    if (input.profile.coverLetterTemplate.trim()) {
      sections.push(
        '',
        '## Style reference — match the tone and structure, but write fresh content for this role',
        input.profile.coverLetterTemplate.slice(0, 2000),
      )
    }

    const body = await this.request<GenerateResponse>(
      `/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: COVER_LETTER_SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: sections.join('\n') }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 700,
          },
        }),
      },
    )

    if (body.promptFeedback?.blockReason) {
      throw new AIProviderError(`Gemini blocked the prompt: ${body.promptFeedback.blockReason}`)
    }

    const text = extractText(body)
    if (!text) throw new AIProviderError('Gemini returned an empty cover letter.')

    return { text }
  }

  async reviewResume(input: ReviewResumeInput): Promise<ResumeReview> {
    if (!this.model) throw new AIProviderError('No Gemini model selected.')

    const resume = input.resumeText.trim()
    if (!resume) throw new AIProviderError('No resume text to review.')

    const sections = [
      '## Role',
      input.jobTitle.trim() || 'Not specified.',
      '',
      '## Job description',
      input.jobDescription.slice(0, 8000),
      '',
      '## Candidate profile',
      profileContext(input.profile),
      '',
      '## Resume text',
      resume.slice(0, 12_000),
    ]

    if (input.missingKeywords.length) {
      sections.push(
        '',
        '## Terms in the posting that do not appear anywhere in the resume',
        input.missingKeywords.slice(0, 20).join(', '),
      )
    }

    const body = await this.request<GenerateResponse>(
      `/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: REVIEW_SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: sections.join('\n') }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2000,
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                verdict: { type: 'STRING' },
                strengths: { type: 'ARRAY', items: { type: 'STRING' } },
                gaps: { type: 'ARRAY', items: { type: 'STRING' } },
                suggestions: { type: 'ARRAY', items: { type: 'STRING' } },
              },
              required: ['verdict'],
            },
          },
        }),
      },
    )

    if (body.promptFeedback?.blockReason) {
      throw new AIProviderError(`Gemini blocked the prompt: ${body.promptFeedback.blockReason}`)
    }

    const parsed = parseJsonObject(extractText(body))
    if (!parsed) throw new AIProviderError('Gemini returned an unparseable review.')

    const review: ResumeReview = {
      verdict: asString(parsed['verdict']),
      strengths: asStringArray(parsed['strengths']),
      gaps: asStringArray(parsed['gaps']),
      suggestions: asStringArray(parsed['suggestions']),
    }

    // A reply with a verdict but no lists is a legitimate (if terse) review;
    // one with nothing at all means generation produced no usable content.
    if (!review.verdict && !review.strengths.length && !review.gaps.length && !review.suggestions.length) {
      throw new AIProviderError('Gemini returned an empty review.')
    }

    return review
  }
}

/** True once the user has granted the optional Gemini host permission. */
export async function hasGeminiPermission(): Promise<boolean> {
  return chrome.permissions.contains({ origins: [GEMINI_HOST_PERMISSION] })
}

/** Must be called from a user gesture — Chrome rejects it otherwise. */
export async function requestGeminiPermission(): Promise<boolean> {
  return chrome.permissions.request({ origins: [GEMINI_HOST_PERMISSION] })
}
