import {
  SCHEMA_VERSION,
  answerEntrySchema,
  applicationSchema,
  capturedJobSchema,
  defaultProfile,
  defaultRunState,
  defaultSettings,
  profileSchema,
  runStateSchema,
  savedJobSchema,
  settingsSchema,
  type AnswerEntry,
  type Application,
  type CapturedJob,
  type Profile,
  type RunState,
  type SavedJob,
  type Settings,
} from './schema'
import { z } from 'zod'

/**
 * Typed wrapper over chrome.storage. Every read is validated and defaulted, so
 * a partially-written or older-shaped record can never crash a caller — the
 * worst case is that you get defaults back.
 */

const LOCAL_KEYS = {
  schemaVersion: 'schemaVersion',
  profile: 'profile',
  settings: 'settings',
  applications: 'applications',
  answers: 'answers',
  savedJobs: 'savedJobs',
} as const

const SESSION_KEY_RUN = 'runState'
const SESSION_KEY_CAPTURED_JOB = 'capturedJob'

/** Applications are kept newest-first and trimmed so storage can't run away. */
const MAX_APPLICATIONS = 2000

function local(): chrome.storage.StorageArea {
  return chrome.storage.local
}

/** chrome.storage.session is MV3-only; fall back to local so tests still run. */
function session(): chrome.storage.StorageArea {
  return chrome.storage.session ?? chrome.storage.local
}

async function readRaw(area: chrome.storage.StorageArea, key: string): Promise<unknown> {
  const bag = await area.get(key)
  return bag[key]
}

/**
 * Parse with a schema, falling back to the schema's own defaults when the
 * stored value is missing or malformed.
 *
 * Generic over the schema rather than over its output type: schemas built from
 * `.default()` have an input type with optional keys, which doesn't unify with
 * a plain `ZodType<T>`.
 */
function parseOr<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown,
  fallback: () => z.output<S>,
): z.output<S> {
  if (raw === undefined || raw === null) return fallback()
  const result = schema.safeParse(raw)
  if (result.success) return result.data
  console.warn('[LosJobios] discarding malformed stored value', result.error.issues)
  return fallback()
}

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export async function getProfile(): Promise<Profile> {
  return parseOr(profileSchema, await readRaw(local(), LOCAL_KEYS.profile), defaultProfile)
}

export async function setProfile(profile: Profile): Promise<void> {
  await local().set({ [LOCAL_KEYS.profile]: profileSchema.parse(profile) })
}

export async function patchProfile(patch: Partial<Profile>): Promise<Profile> {
  const next = profileSchema.parse({ ...(await getProfile()), ...patch })
  await local().set({ [LOCAL_KEYS.profile]: next })
  return next
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function getSettings(): Promise<Settings> {
  return parseOr(settingsSchema, await readRaw(local(), LOCAL_KEYS.settings), defaultSettings)
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = settingsSchema.parse({ ...(await getSettings()), ...patch })
  await local().set({ [LOCAL_KEYS.settings]: next })
  return next
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

const applicationsSchema = z.array(applicationSchema)

export async function getApplications(): Promise<Application[]> {
  return parseOr(
    applicationsSchema,
    await readRaw(local(), LOCAL_KEYS.applications),
    () => [] as Application[],
  )
}

/**
 * Insert newest-first. Re-applying to the same job replaces the earlier row
 * rather than adding a duplicate.
 */
export async function addApplication(app: Application): Promise<void> {
  const parsed = applicationSchema.parse(app)
  const existing = await getApplications()
  const deduped = existing.filter(
    (a) => !(a.source === parsed.source && a.externalId && a.externalId === parsed.externalId),
  )
  deduped.unshift(parsed)
  await local().set({ [LOCAL_KEYS.applications]: deduped.slice(0, MAX_APPLICATIONS) })
}

export async function updateApplication(
  id: string,
  patch: Partial<Application>,
): Promise<void> {
  const all = await getApplications()
  const next = all.map((a) =>
    a.id === id ? applicationSchema.parse({ ...a, ...patch, updatedAt: Date.now() }) : a,
  )
  await local().set({ [LOCAL_KEYS.applications]: next })
}

export async function deleteApplication(id: string): Promise<void> {
  const all = await getApplications()
  await local().set({ [LOCAL_KEYS.applications]: all.filter((a) => a.id !== id) })
}

export async function clearApplications(): Promise<void> {
  await local().set({ [LOCAL_KEYS.applications]: [] })
}

/** Write the whole list at once — used by a restore, not by a run. */
export async function replaceApplications(applications: Application[]): Promise<void> {
  await local().set({
    [LOCAL_KEYS.applications]: applicationsSchema.parse(applications).slice(0, MAX_APPLICATIONS),
  })
}

/** True when this job was already applied to for real (dry runs don't count). */
export async function hasAppliedTo(source: string, externalId: string): Promise<boolean> {
  if (!externalId) return false
  const all = await getApplications()
  return all.some((a) => a.source === source && a.externalId === externalId && !a.dryRun)
}

/**
 * Ids already applied to on a given source, as a set.
 *
 * Filtering a freshly-scraped queue with `hasAppliedTo` would re-read and
 * re-validate the whole applications array once per job — dozens of full
 * parses to answer one question. One read, one set.
 */
export async function appliedExternalIds(source: string): Promise<Set<string>> {
  const all = await getApplications()
  const ids = new Set<string>()
  for (const app of all) {
    if (app.source === source && app.externalId && !app.dryRun) ids.add(app.externalId)
  }
  return ids
}

// ---------------------------------------------------------------------------
// Saved jobs
// ---------------------------------------------------------------------------

const savedJobsSchema = z.array(savedJobSchema)

/** Plenty of history without letting one long session fill the quota. */
const MAX_SAVED_JOBS = 500

export async function getSavedJobs(): Promise<SavedJob[]> {
  return parseOr(savedJobsSchema, await readRaw(local(), LOCAL_KEYS.savedJobs), () => [])
}

/** Replace one job in place, matched on id. */
export async function putSavedJob(job: SavedJob): Promise<void> {
  const parsed = savedJobSchema.parse(job)
  const all = await getSavedJobs()
  const idx = all.findIndex((entry) => entry.id === parsed.id)

  if (idx >= 0) all[idx] = parsed
  else all.unshift(parsed)

  await local().set({ [LOCAL_KEYS.savedJobs]: all.slice(0, MAX_SAVED_JOBS) })
}

/**
 * Add freshly scraped postings, newest first.
 *
 * Re-scraping the same search must not pile up duplicates, so an incoming
 * job that matches one already stored updates it instead — and only with
 * fields that carry something, so a card scrape (title only) can never wipe
 * the description a later visit to the posting filled in.
 */
export async function addScrapedJobs(jobs: SavedJob[]): Promise<number> {
  if (!jobs.length) return 0

  const all = await getSavedJobs()
  const keyOf = (job: SavedJob) => `${job.source}:${job.externalId || job.url}`
  const byKey = new Map(all.map((job) => [keyOf(job), job]))

  let added = 0

  for (const incoming of jobs) {
    const parsed = savedJobSchema.parse(incoming)
    const existing = byKey.get(keyOf(parsed))

    if (!existing) {
      byKey.set(keyOf(parsed), parsed)
      all.unshift(parsed)
      added += 1
      continue
    }

    existing.title = parsed.title || existing.title
    existing.company = parsed.company || existing.company
    existing.location = parsed.location || existing.location
    existing.url = parsed.url || existing.url
    existing.description = parsed.description || existing.description
  }

  await local().set({ [LOCAL_KEYS.savedJobs]: all.slice(0, MAX_SAVED_JOBS) })
  return added
}

export async function deleteSavedJob(id: string): Promise<void> {
  const all = await getSavedJobs()
  await local().set({ [LOCAL_KEYS.savedJobs]: all.filter((job) => job.id !== id) })
}

export async function clearSavedJobs(): Promise<void> {
  await local().set({ [LOCAL_KEYS.savedJobs]: [] })
}

export async function replaceSavedJobs(jobs: SavedJob[]): Promise<void> {
  await local().set({
    [LOCAL_KEYS.savedJobs]: savedJobsSchema.parse(jobs).slice(0, MAX_SAVED_JOBS),
  })
}

// ---------------------------------------------------------------------------
// Answer bank
// ---------------------------------------------------------------------------

const answersSchema = z.array(answerEntrySchema)

export async function getAnswers(): Promise<AnswerEntry[]> {
  return parseOr(
    answersSchema,
    await readRaw(local(), LOCAL_KEYS.answers),
    () => [] as AnswerEntry[],
  )
}

export async function putAnswer(entry: AnswerEntry): Promise<void> {
  const parsed = answerEntrySchema.parse(entry)
  const all = await getAnswers()
  const idx = all.findIndex((a) => a.normalized === parsed.normalized && a.kind === parsed.kind)
  if (idx >= 0) all[idx] = parsed
  else all.push(parsed)
  await local().set({ [LOCAL_KEYS.answers]: all })
}

export async function deleteAnswer(id: string): Promise<void> {
  const all = await getAnswers()
  await local().set({ [LOCAL_KEYS.answers]: all.filter((a) => a.id !== id) })
}

export async function replaceAnswers(answers: AnswerEntry[]): Promise<void> {
  await local().set({ [LOCAL_KEYS.answers]: answersSchema.parse(answers) })
}

/** Bump usage stats after an answer is reused, without rewriting its content. */
export async function touchAnswer(id: string): Promise<void> {
  const all = await getAnswers()
  const next = all.map((a) =>
    a.id === id ? { ...a, useCount: a.useCount + 1, lastUsedAt: Date.now() } : a,
  )
  await local().set({ [LOCAL_KEYS.answers]: next })
}

// ---------------------------------------------------------------------------
// Run state — session-scoped so a killed service worker can pick back up
// ---------------------------------------------------------------------------

export async function getRunState(): Promise<RunState> {
  return parseOr(runStateSchema, await readRaw(session(), SESSION_KEY_RUN), defaultRunState)
}

export async function setRunState(state: RunState): Promise<void> {
  await session().set({ [SESSION_KEY_RUN]: runStateSchema.parse(state) })
}

export async function patchRunState(patch: Partial<RunState>): Promise<RunState> {
  const next = runStateSchema.parse({ ...(await getRunState()), ...patch })
  await session().set({ [SESSION_KEY_RUN]: next })
  return next
}

// ---------------------------------------------------------------------------
// Captured job — the popup hands one to the ATS scorer on the options page
// ---------------------------------------------------------------------------

export async function setCapturedJob(job: CapturedJob): Promise<void> {
  await session().set({ [SESSION_KEY_CAPTURED_JOB]: capturedJobSchema.parse(job) })
}

/** The last posting scraped from a page, or null if none this browser session. */
export async function getCapturedJob(): Promise<CapturedJob | null> {
  const raw = await readRaw(session(), SESSION_KEY_CAPTURED_JOB)
  if (raw === undefined || raw === null) return null
  const parsed = capturedJobSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

// ---------------------------------------------------------------------------
// Change subscription
// ---------------------------------------------------------------------------

type ChangeHandler = () => void

/**
 * Fire `handler` whenever any of `keys` changes in any storage area. Returns an
 * unsubscribe function suitable for a React effect cleanup.
 */
export function onStorageChanged(keys: string[], handler: ChangeHandler): () => void {
  const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
    if (keys.some((k) => k in changes)) handler()
  }
  chrome.storage.onChanged.addListener(listener)
  return () => chrome.storage.onChanged.removeListener(listener)
}

export const STORAGE_KEYS = { ...LOCAL_KEYS, runState: SESSION_KEY_RUN } as const

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

/**
 * Runs on install/update. Today it only stamps the version — the parse-with-
 * defaults reads above absorb additive schema changes on their own. Breaking
 * changes get an explicit step here keyed on the stored version.
 */
export async function runMigrations(): Promise<void> {
  const stored = await readRaw(local(), LOCAL_KEYS.schemaVersion)
  const from = typeof stored === 'number' ? stored : 0

  if (from === SCHEMA_VERSION) return

  if (from === 0) {
    // Fresh install: materialize defaults so the options page has something to
    // render and the run engine never sees an empty bag.
    await local().set({
      [LOCAL_KEYS.profile]: defaultProfile(),
      [LOCAL_KEYS.settings]: defaultSettings(),
      [LOCAL_KEYS.applications]: [],
      [LOCAL_KEYS.answers]: [],
    })
  }

  await local().set({ [LOCAL_KEYS.schemaVersion]: SCHEMA_VERSION })
}
