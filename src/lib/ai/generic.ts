import type { AiProviderConfig } from '../schema'
import { parseJsonReply, type ChatRequest } from './chat'
import { buildChatProvider, generateWithRetry, PROVIDER_LABELS } from './registry'
import {
  AIProviderError,
  profileContext,
  type AIProvider,
  type AnswerQuestionInput,
  type AnswerQuestionResult,
  type GeneratedResume,
  type GenerateCoverLetterInput,
  type GenerateCoverLetterResult,
  type GenerateResumeInput,
  type ParsedResume,
  type ProviderModel,
  type ResumeReview,
  type ReviewResumeInput,
} from './provider'

/**
 * Every task, on any vendor.
 *
 * `GeminiProvider` stays the implementation for Gemini because it can use
 * Gemini's native `responseSchema`, which constrains the reply at the API
 * rather than by asking nicely. No other vendor offers that, so this asks for
 * JSON in the prompt and validates what comes back — the same jobs, one layer
 * less certainty, which is the honest trade for provider choice.
 */

/** The instruction every structured call carries. */
const JSON_RULES = [
  'Reply with one JSON object and nothing else: no prose, no explanation, no markdown fence.',
  'Use exactly the keys described. Omit nothing.',
].join(' ')

/**
 * The rule that matters most, repeated into every prompt that speaks for the
 * candidate. A fabricated year of experience or an invented certification is
 * sent to a real employer under their name, and is worse than no answer.
 */
const NO_INVENTION =
  'Only state things supported by the candidate information given. Never invent employers, dates, qualifications, certifications, languages or metrics. If the information needed is not there, say so rather than guessing.'

function jobLine(job: { title: string; company: string; location: string } | null): string {
  if (!job) return 'Not specified.'
  return [job.title || 'Unknown title', job.company ? `at ${job.company}` : '', job.location ? `(${job.location})` : '']
    .filter(Boolean)
    .join(' ')
}

export class GenericChatProvider implements AIProvider {
  constructor(private readonly config: AiProviderConfig, private readonly options: { timeoutMs: number; retries: number }) {}

  get name(): string {
    return this.config.name || PROVIDER_LABELS[this.config.type]
  }

  async listModels(): Promise<ProviderModel[]> {
    return buildChatProvider(this.config).listModels()
  }

  /** One structured call, with the provider's own temperature and cap. */
  private async json<T>(request: Omit<ChatRequest, 'json' | 'signal'>): Promise<T> {
    const text = await generateWithRetry(
      this.config,
      {
        ...request,
        json: true,
        temperature: request.temperature ?? this.config.temperature,
        maxTokens: request.maxTokens ?? this.config.maxTokens,
      },
      this.options,
    )
    return parseJsonReply<T>(this.name, text)
  }

  private async text(request: Omit<ChatRequest, 'json' | 'signal'>): Promise<string> {
    return generateWithRetry(
      this.config,
      {
        ...request,
        temperature: request.temperature ?? this.config.temperature,
        maxTokens: request.maxTokens ?? this.config.maxTokens,
      },
      this.options,
    )
  }

  async answerQuestion(input: AnswerQuestionInput): Promise<AnswerQuestionResult> {
    const sections = [
      '## Candidate',
      profileContext(input.profile),
      '',
      '## Role',
      jobLine(input.job),
    ]

    if (input.jobDescription.trim()) {
      sections.push('', '## Job description', input.jobDescription.slice(0, 6000))
    }

    // Previously-answered questions, so the model stays consistent with what
    // the candidate has already told other employers.
    if (input.relatedAnswers?.length) {
      sections.push(
        '',
        '## How this candidate answered similar questions before',
        ...input.relatedAnswers.map((a) => `- "${a.question}" → "${a.answer}"`),
      )
    }

    sections.push('', '## Question', input.question, `Input type: ${input.kind}`)

    if (input.options.length) {
      sections.push(
        '',
        '## Allowed answers — copy exactly one of these, verbatim',
        ...input.options.map((o) => `- ${o}`),
      )
    }

    if (input.language) {
      sections.push('', `## Language`, `Answer in ${input.language}. The form is in that language.`)
    }

    const result = await this.json<{ answer?: unknown; confidence?: unknown; reasoning?: unknown }>({
      system: [
        'You fill in job application forms on behalf of a candidate.',
        NO_INVENTION,
        'If you cannot answer from the information given, return an empty answer and a confidence of 0.',
        JSON_RULES,
        'Keys: answer (string), confidence (number 0-1), reasoning (one short sentence).',
      ].join(' '),
      messages: [{ role: 'user', content: sections.join('\n') }],
    })

    const answer = typeof result.answer === 'string' ? result.answer.trim() : ''
    const confidence =
      typeof result.confidence === 'number' && Number.isFinite(result.confidence)
        ? Math.min(Math.max(result.confidence, 0), 1)
        : 0

    return {
      answer,
      // An empty answer is a refusal, whatever number came with it.
      confidence: answer ? confidence : 0,
      reasoning: typeof result.reasoning === 'string' ? result.reasoning : '',
    }
  }

  async generateCoverLetter(input: GenerateCoverLetterInput): Promise<GenerateCoverLetterResult> {
    const sections = ['## Candidate', profileContext(input.profile), '', '## Role', jobLine(input.job)]

    if (input.jobDescription.trim()) {
      sections.push('', '## Job description', input.jobDescription.slice(0, 6000))
    }

    const text = await this.text({
      system: [
        'You write a short, specific cover letter in the first person.',
        NO_INVENTION,
        'Three or four short paragraphs. No greeting line, no sign-off, no placeholders in square brackets.',
        'Write in the language of the job description.',
      ].join(' '),
      messages: [{ role: 'user', content: sections.join('\n') }],
      maxTokens: Math.max(this.config.maxTokens, 1200),
    })

    return { text: text.trim() }
  }

  async parseResume(resumeText: string): Promise<ParsedResume> {
    const text = resumeText.trim()
    if (!text) throw new AIProviderError('No resume text to parse.')

    return this.json<ParsedResume>({
      system: [
        'You extract structured data from a CV.',
        'Copy values from the document; never infer or embellish. Leave a field out when the document does not state it.',
        JSON_RULES,
        'Keys: firstName, lastName, email, phone, city, state, postalCode, country, linkedinUrl, portfolioUrl, githubUrl, headline, summary, currentTitle, currentCompany, yearsExperience (number), skills (string[]), languages (string[]), experience (array of {company,title,location,startDate,endDate,current,description}), education (array of {school,degree,field,startYear,endYear,grade}).',
      ].join(' '),
      messages: [{ role: 'user', content: text.slice(0, 20_000) }],
      maxTokens: Math.max(this.config.maxTokens, 4000),
    })
  }

  async reviewResume(input: ReviewResumeInput): Promise<ResumeReview> {
    const sections = [
      '## Candidate',
      profileContext(input.profile),
      '',
      '## Target role',
      input.jobTitle || 'Not specified.',
      '',
      '## Job description',
      input.jobDescription.slice(0, 6000),
      '',
      '## Resume text',
      input.resumeText.slice(0, 10_000),
    ]

    if (input.missingKeywords.length) {
      sections.push('', '## Terms the posting uses that the resume does not', input.missingKeywords.join(', '))
    }

    return this.json<ResumeReview>({
      system: [
        'You review a CV against one job posting.',
        'Give no score — a separate deterministic scorer produces the number, and a second one would contradict it.',
        'Every suggestion must be an edit the candidate can honestly make from what is already true of them.',
        JSON_RULES,
        'Keys: verdict (one sentence), strengths (string[]), gaps (string[]), suggestions (string[]).',
      ].join(' '),
      messages: [{ role: 'user', content: sections.join('\n') }],
      maxTokens: Math.max(this.config.maxTokens, 2000),
    })
  }

  async generateResume(input: GenerateResumeInput): Promise<GeneratedResume> {
    const roles = input.profile.experience
      .map((role, index) => `${index}: ${role.title} at ${role.company} — ${role.description}`)
      .join('\n')

    const sections = [
      '## Candidate',
      profileContext(input.profile),
      '',
      '## Roles, by index',
      roles || 'None recorded.',
      '',
      '## Target role',
      input.jobTitle || 'Not specified.',
      '',
      '## Job description',
      input.jobDescription.slice(0, 6000),
    ]

    if (input.resumeText.trim()) {
      sections.push('', '## Existing resume text', input.resumeText.slice(0, 8000))
    }
    if (input.missingKeywords.length) {
      sections.push('', '## Terms the posting uses that the resume does not', input.missingKeywords.join(', '))
    }

    return this.json<GeneratedResume>({
      system: [
        'You rewrite the WORDING of a CV for one posting.',
        NO_INVENTION,
        'Identify each role only by its index from the list given. Never write a company name, job title or date — those are reattached from stored data afterwards.',
        'Only reorder and rephrase skills the candidate already has; never add one.',
        JSON_RULES,
        'Keys: summary (string), skills (string[]), roles (array of {index (number), bullets (string[])}), notes (string[] — what you changed and anything you refused to claim).',
      ].join(' '),
      messages: [{ role: 'user', content: sections.join('\n') }],
      maxTokens: Math.max(this.config.maxTokens, 3000),
    })
  }
}
