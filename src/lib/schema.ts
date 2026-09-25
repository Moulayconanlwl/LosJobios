import { z } from 'zod'

/**
 * Every persisted shape in one place. Storage reads validate against these, so a
 * schema change plus a bumped SCHEMA_VERSION is the only thing a migration needs.
 */

export const SCHEMA_VERSION = 1

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const experienceEntrySchema = z.object({
  id: z.string(),
  company: z.string().default(''),
  title: z.string().default(''),
  location: z.string().default(''),
  startDate: z.string().default(''), // free-form "2021-03" / "March 2021"
  endDate: z.string().default(''),
  current: z.boolean().default(false),
  description: z.string().default(''),
})

export const educationEntrySchema = z.object({
  id: z.string(),
  school: z.string().default(''),
  degree: z.string().default(''),
  field: z.string().default(''),
  startYear: z.string().default(''),
  endYear: z.string().default(''),
  grade: z.string().default(''),
})

export const resumeFileSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  /** Base64 payload (no data: prefix) so it survives chrome.storage JSON. */
  dataBase64: z.string(),
  /** Extracted plain text, used as AI context and for ATS scoring later. */
  text: z.string().default(''),
  sizeBytes: z.number().default(0),
  updatedAt: z.number().default(0),
})

/** Answers to the demographic questions US job boards ask. Opt-in, never guessed. */
export const voluntaryDisclosureSchema = z.object({
  gender: z.string().default('Decline to self-identify'),
  ethnicity: z.string().default('Decline to self-identify'),
  veteranStatus: z.string().default('I don’t wish to answer'),
  disabilityStatus: z.string().default('I don’t wish to answer'),
})

export const profileSchema = z.object({
  firstName: z.string().default(''),
  lastName: z.string().default(''),
  email: z.string().default(''),
  phoneCountryCode: z.string().default('+1'),
  phone: z.string().default(''),

  addressLine1: z.string().default(''),
  city: z.string().default(''),
  state: z.string().default(''),
  postalCode: z.string().default(''),
  country: z.string().default(''),

  linkedinUrl: z.string().default(''),
  portfolioUrl: z.string().default(''),
  githubUrl: z.string().default(''),

  headline: z.string().default(''),
  summary: z.string().default(''),
  currentTitle: z.string().default(''),
  currentCompany: z.string().default(''),
  yearsExperience: z.number().min(0).max(60).default(0),

  /** Notice period in weeks; 0 means immediately available. */
  noticePeriodWeeks: z.number().min(0).max(52).default(2),
  desiredSalary: z.string().default(''),
  salaryCurrency: z.string().default('USD'),

  workAuthorized: z.boolean().default(true),
  requiresSponsorship: z.boolean().default(false),
  willingToRelocate: z.boolean().default(false),
  remotePreference: z.enum(['remote', 'hybrid', 'onsite', 'any']).default('any'),

  skills: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  experience: z.array(experienceEntrySchema).default([]),
  education: z.array(educationEntrySchema).default([]),

  voluntaryDisclosure: voluntaryDisclosureSchema.default({}),
  resume: resumeFileSchema.nullable().default(null),
  coverLetterTemplate: z.string().default(''),
})

export type Profile = z.infer<typeof profileSchema>
export type ExperienceEntry = z.infer<typeof experienceEntrySchema>
export type EducationEntry = z.infer<typeof educationEntrySchema>
export type ResumeFile = z.infer<typeof resumeFileSchema>

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const aiSettingsSchema = z.object({
  provider: z.enum(['gemini', 'none']).default('gemini'),
  apiKey: z.string().default(''),
  model: z.string().default(''),
  /** Let the AI answer screening questions the bank and heuristics can't. */
  answerQuestions: z.boolean().default(true),
})

export const settingsSchema = z.object({
  /** Drives the whole modal but never clicks the final Submit. On by default. */
  dryRun: z.boolean().default(true),
  dailyCap: z.number().min(1).max(200).default(25),
  /** Randomized inter-action pacing, in milliseconds. */
  minActionDelayMs: z.number().min(150).default(600),
  maxActionDelayMs: z.number().min(200).default(1800),
  /** Randomized gap between whole applications. */
  minJobDelayMs: z.number().min(1000).default(4000),
  maxJobDelayMs: z.number().min(1000).default(12000),

  /** Stop and ask rather than submitting a required field we can't answer. */
  pauseOnUnknownRequired: z.boolean().default(true),
  skipAlreadyApplied: z.boolean().default(true),

  titleIncludeKeywords: z.array(z.string()).default([]),
  titleExcludeKeywords: z.array(z.string()).default([]),
  blockedCompanies: z.array(z.string()).default([]),

  ai: aiSettingsSchema.default({}),
})

export type Settings = z.infer<typeof settingsSchema>
export type AiSettings = z.infer<typeof aiSettingsSchema>

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

export const APPLICATION_STATUSES = [
  'applied',
  'screening',
  'interview',
  'offer',
  'rejected',
  'withdrawn',
] as const

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number]

export const applicationSchema = z.object({
  id: z.string(),
  /** Stable per-site job id when we can find one; used for dedupe. */
  externalId: z.string().default(''),
  title: z.string().default(''),
  company: z.string().default(''),
  location: z.string().default(''),
  url: z.string().default(''),
  source: z.enum(['linkedin', 'universal', 'manual']).default('linkedin'),
  status: z.enum(APPLICATION_STATUSES).default('applied'),
  appliedAt: z.number(),
  updatedAt: z.number(),
  /** True when logged from a dry run — never counts toward real application stats. */
  dryRun: z.boolean().default(false),
  questionsAnswered: z.number().default(0),
  aiAnswersUsed: z.number().default(0),
  notes: z.string().default(''),
})

export type Application = z.infer<typeof applicationSchema>

// ---------------------------------------------------------------------------
// Answer bank
// ---------------------------------------------------------------------------

export const FIELD_KINDS = [
  'text',
  'textarea',
  'number',
  'email',
  'tel',
  'url',
  'select',
  'radio',
  'checkbox',
  'date',
  'file',
  'unknown',
] as const

export type FieldKind = (typeof FIELD_KINDS)[number]

export const answerEntrySchema = z.object({
  id: z.string(),
  /** Question as shown on the page. */
  question: z.string(),
  /** Lowercased, punctuation-stripped form used for matching. */
  normalized: z.string(),
  kind: z.enum(FIELD_KINDS).default('text'),
  answer: z.string(),
  /** Options the control offered, when it was a select/radio. */
  options: z.array(z.string()).default([]),
  source: z.enum(['user', 'ai', 'heuristic']).default('user'),
  /** AI-sourced answers start unconfirmed so you can review them. */
  confirmed: z.boolean().default(false),
  useCount: z.number().default(0),
  createdAt: z.number(),
  lastUsedAt: z.number().default(0),
})

export type AnswerEntry = z.infer<typeof answerEntrySchema>

// ---------------------------------------------------------------------------
// Run state (session-scoped)
// ---------------------------------------------------------------------------

export const jobRefSchema = z.object({
  externalId: z.string(),
  title: z.string().default(''),
  company: z.string().default(''),
  location: z.string().default(''),
  url: z.string().default(''),
})

export type JobRef = z.infer<typeof jobRefSchema>

/**
 * A posting scraped off the page the user was looking at, handed from the
 * popup to the ATS scorer on the options page. Session-scoped scratch data —
 * it exists to save a copy-paste, not to be kept.
 */
export const capturedJobSchema = z.object({
  title: z.string().default(''),
  company: z.string().default(''),
  description: z.string().default(''),
  url: z.string().default(''),
  capturedAt: z.number().default(0),
})

export type CapturedJob = z.infer<typeof capturedJobSchema>

export const RUN_STATUSES = ['idle', 'running', 'paused', 'blocked', 'finished'] as const
export type RunStatus = (typeof RUN_STATUSES)[number]

/** A required question the resolver could not answer; surfaced to the user. */
export const pendingQuestionSchema = z.object({
  question: z.string(),
  kind: z.enum(FIELD_KINDS),
  options: z.array(z.string()).default([]),
  jobTitle: z.string().default(''),
  company: z.string().default(''),
})

export type PendingQuestion = z.infer<typeof pendingQuestionSchema>

export const runStateSchema = z.object({
  status: z.enum(RUN_STATUSES).default('idle'),
  tabId: z.number().nullable().default(null),
  /** Which frame within tabId actually has the page's content — see background/frames.ts. */
  frameId: z.number().nullable().default(null),
  startedAt: z.number().default(0),
  queue: z.array(jobRefSchema).default([]),
  cursor: z.number().default(0),
  currentJob: jobRefSchema.nullable().default(null),
  applied: z.number().default(0),
  skipped: z.number().default(0),
  failed: z.number().default(0),
  /** ISO date (YYYY-MM-DD) the dailyCount below belongs to. */
  countedOn: z.string().default(''),
  dailyCount: z.number().default(0),
  pendingQuestion: pendingQuestionSchema.nullable().default(null),
  lastMessage: z.string().default(''),
  lastError: z.string().default(''),
})

export type RunState = z.infer<typeof runStateSchema>

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const defaultProfile = (): Profile => profileSchema.parse({})
export const defaultSettings = (): Settings => settingsSchema.parse({})
export const defaultRunState = (): RunState => runStateSchema.parse({})
