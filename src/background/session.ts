import { rememberUserAnswer } from '@/lib/answers'
import { NoReceiverError, sendToTab, type Ack } from '@/lib/messaging'
import type { Application, JobRef, RunState } from '@/lib/schema'
import {
  addApplication,
  appliedExternalIds,
  getRunState,
  getSettings,
  patchRunState,
  setRunState,
} from '@/lib/storage'
import { defaultRunState } from '@/lib/schema'
import { clearContentFrame, resolveContentFrame } from './frames'
import { ensureContentScript, getActiveTab, isLinkedInJobsPage } from './injector'

/**
 * The run engine.
 *
 * The hard constraint here is that an MV3 service worker is not a process you
 * can rely on. Chrome kills it after ~30 seconds of inactivity, and a run that
 * works through 25 applications takes many minutes. So:
 *
 *   - Every piece of run state lives in chrome.storage.session, written after
 *     each job. Nothing important is ever only in a local variable.
 *   - The loop itself is restartable and idempotent: `ensureLoop()` picks up
 *     wherever the stored cursor left off.
 *   - A one-minute alarm acts as a watchdog, restarting the loop if the worker
 *     was torn down while the stored status still says "running".
 */

/** Guards against two loops running in one worker instance. */
let loopActive = false

const WATCHDOG_ALARM = 'losjobios-watchdog'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function randomBetween(min: number, max: number): number {
  return max <= min ? min : Math.floor(min + Math.random() * (max - min))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Reset the daily counter when the date has rolled over. */
async function withFreshDailyCount(state: RunState): Promise<RunState> {
  if (state.countedOn === today()) return state
  return patchRunState({ countedOn: today(), dailyCount: 0 })
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function startRun(): Promise<Ack> {
  const existing = await getRunState()
  if (existing.status === 'running') return { ok: false, error: 'A run is already in progress.' }

  const tab = await getActiveTab()
  if (!tab?.id) return { ok: false, error: 'No active tab.' }

  if (!isLinkedInJobsPage(tab.url)) {
    return {
      ok: false,
      error: 'Open a LinkedIn job search page first (linkedin.com/jobs/search).',
    }
  }

  const ready = await ensureContentScript(tab.id)
  if (!ready) return { ok: false, error: 'Could not reach the page. Try reloading it.' }

  // A run is worthless against the wrong frame, so this one waits for a
  // claim rather than falling straight back to frame 0.
  const frameId = await resolveContentFrame(tab.id, 8000)

  const settings = await getSettings()
  const fresh = await withFreshDailyCount({ ...defaultRunState(), ...existing })

  const remaining = settings.dailyCap - fresh.dailyCount
  if (remaining <= 0) {
    return { ok: false, error: `Daily cap of ${settings.dailyCap} already reached.` }
  }

  await setRunState({
    ...defaultRunState(),
    status: 'running',
    tabId: tab.id,
    frameId: frameId ?? null,
    startedAt: Date.now(),
    countedOn: today(),
    dailyCount: fresh.dailyCount,
    lastMessage: 'Collecting jobs…',
  })

  let jobs: JobRef[] = []
  let scrapedCount = 0
  try {
    // Over-fetch: a good share get filtered out as already-applied or external.
    const response = await sendToTab(tab.id, 'cs/collect-jobs', { limit: remaining * 3 }, { frameId })
    jobs = response.jobs
    scrapedCount = response.jobs.length

    // The content script already knows the specific reason (signed out,
    // nothing on the page matched at all, everything failed the keyword
    // filters) — that's always more useful than a generic message.
    if (scrapedCount === 0 && response.emptyReason) {
      await patchRunState({ status: 'idle', lastError: response.emptyReason })
      return { ok: false, error: response.emptyReason }
    }
  } catch (err) {
    await patchRunState({ status: 'idle', lastError: describeError(err) })
    return { ok: false, error: describeError(err) }
  }

  if (settings.skipAlreadyApplied) {
    const already = await appliedExternalIds('linkedin')
    jobs = jobs.filter((job) => !already.has(job.externalId))
  }

  jobs = jobs.slice(0, remaining)

  if (!jobs.length) {
    // Distinguish "found nothing at all" (already handled above) from "found
    // jobs, but every one was already applied to" — otherwise this looks
    // identical to a filter/markup problem and sends the user chasing the
    // wrong thing.
    const message =
      scrapedCount > 0
        ? 'Every job on this page was already applied to. Try a different search or collections page.'
        : 'No new jobs matched your filters on this page.'
    await patchRunState({ status: 'finished', lastMessage: message })
    return { ok: false, error: message }
  }

  await patchRunState({
    queue: jobs,
    cursor: 0,
    lastMessage: `Queued ${jobs.length} jobs.`,
  })

  void ensureLoop()
  return { ok: true }
}

export async function pauseRun(): Promise<Ack> {
  const state = await getRunState()
  if (state.status !== 'running') return { ok: false, error: 'Nothing is running.' }

  await patchRunState({ status: 'paused', lastMessage: 'Paused.' })
  await abortContent(state.tabId, state.frameId)
  return { ok: true }
}

export async function resumeRun(): Promise<Ack> {
  const state = await getRunState()
  if (state.status !== 'paused' && state.status !== 'blocked') {
    return { ok: false, error: 'Nothing to resume.' }
  }

  await patchRunState({ status: 'running', pendingQuestion: null, lastMessage: 'Resuming…' })
  void ensureLoop()
  return { ok: true }
}

export async function stopRun(): Promise<Ack> {
  const state = await getRunState()
  await patchRunState({ status: 'idle', queue: [], cursor: 0, currentJob: null, lastMessage: 'Stopped.' })
  await abortContent(state.tabId, state.frameId)
  return { ok: true }
}

/**
 * Supply the answer to the question that blocked the run, then carry on. The
 * cursor was never advanced, so the same job is retried — this time the answer
 * bank has what it needs.
 */
export async function answerPending(answer: string, remember: boolean): Promise<Ack> {
  const state = await getRunState()
  if (state.status !== 'blocked' || !state.pendingQuestion) {
    return { ok: false, error: 'No question is waiting.' }
  }

  const { question, kind, options } = state.pendingQuestion
  if (remember) await rememberUserAnswer(question, kind, answer, options)

  await patchRunState({
    status: 'running',
    pendingQuestion: null,
    lastMessage: 'Answer saved — retrying that job.',
  })

  void ensureLoop()
  return { ok: true }
}

async function abortContent(tabId: number | null, frameId: number | null): Promise<void> {
  if (tabId === null) return
  try {
    await sendToTab(tabId, 'cs/abort', {}, { frameId: frameId ?? undefined })
  } catch {
    // The tab being gone is exactly why we're aborting.
  }
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

/** Start the loop if the stored state says it should be running and it isn't. */
export async function ensureLoop(): Promise<void> {
  if (loopActive) return
  const state = await getRunState()
  if (state.status !== 'running') return

  loopActive = true
  try {
    await runLoop()
  } catch (err) {
    console.error('[LosJobios] run loop crashed', err)
    await patchRunState({ status: 'paused', lastError: describeError(err) })
  } finally {
    loopActive = false
  }
}

async function runLoop(): Promise<void> {
  for (;;) {
    const settings = await getSettings()
    let state = await withFreshDailyCount(await getRunState())

    if (state.status !== 'running') return

    if (state.cursor >= state.queue.length) {
      await patchRunState({
        status: 'finished',
        currentJob: null,
        lastMessage: `Done — ${state.applied} applied, ${state.skipped} skipped, ${state.failed} failed.`,
      })
      return
    }

    if (state.dailyCount >= settings.dailyCap) {
      await patchRunState({
        status: 'finished',
        currentJob: null,
        lastMessage: `Daily cap of ${settings.dailyCap} reached.`,
      })
      return
    }

    const job = state.queue[state.cursor]
    if (!job) {
      await patchRunState({ cursor: state.cursor + 1 })
      continue
    }

    if (state.tabId === null) {
      await patchRunState({ status: 'paused', lastError: 'Lost track of the tab.' })
      return
    }

    await patchRunState({
      currentJob: job,
      lastMessage: `Applying — ${job.title || 'job'} at ${job.company || 'company'}`,
    })

    const advanced = await processJob(state.tabId, state.frameId, job, settings.dryRun)
    if (!advanced) return // blocked or paused; state already reflects it

    state = await getRunState()
    if (state.status !== 'running') return

    await sleep(randomBetween(settings.minJobDelayMs, settings.maxJobDelayMs))
  }
}

/**
 * Apply to one job. Returns false when the run should stop here (blocked on a
 * question, or the tab went away) — true when the cursor moved on.
 */
async function processJob(
  tabId: number,
  frameId: number | null,
  job: JobRef,
  dryRun: boolean,
): Promise<boolean> {
  let outcome

  try {
    outcome = await sendToTab(tabId, 'cs/apply-job', { job, dryRun }, { frameId: frameId ?? undefined })
  } catch (err) {
    if (err instanceof NoReceiverError) {
      // Usually the user navigated away or closed the tab mid-run.
      await patchRunState({
        status: 'paused',
        lastError: 'Lost the page. Reopen the job search and resume.',
      })
      return false
    }
    await bumpCounter('failed', describeError(err))
    await advanceCursor()
    return true
  }

  switch (outcome.result) {
    case 'applied': {
      await recordApplication(job, dryRun, outcome.questionsAnswered, outcome.aiAnswersUsed)

      const state = await getRunState()
      await patchRunState({
        applied: state.applied + 1,
        // Dry runs shouldn't burn the real daily allowance.
        dailyCount: dryRun ? state.dailyCount : state.dailyCount + 1,
        lastMessage: dryRun
          ? `Dry run OK — ${job.title}`
          : `Applied — ${job.title} at ${job.company}`,
      })
      await advanceCursor()
      return true
    }

    case 'skipped':
      await bumpCounter('skipped', outcome.reason)
      await advanceCursor()
      return true

    case 'blocked':
      // Deliberately does NOT advance the cursor — once answered, this same job
      // is retried from the top.
      await patchRunState({
        status: 'blocked',
        pendingQuestion: outcome.question,
        lastMessage: 'Waiting on you to answer a question.',
      })
      return false

    case 'failed':
      await bumpCounter('failed', outcome.error)
      await advanceCursor()
      return true

    default:
      await advanceCursor()
      return true
  }
}

async function advanceCursor(): Promise<void> {
  const state = await getRunState()
  await patchRunState({ cursor: state.cursor + 1, currentJob: null })
}

async function bumpCounter(field: 'skipped' | 'failed', message: string): Promise<void> {
  const state = await getRunState()
  await patchRunState({
    [field]: state[field] + 1,
    lastMessage: message,
    ...(field === 'failed' ? { lastError: message } : {}),
  })
}

async function recordApplication(
  job: JobRef,
  dryRun: boolean,
  questionsAnswered: number,
  aiAnswersUsed: number,
): Promise<void> {
  const now = Date.now()
  const application: Application = {
    id: crypto.randomUUID(),
    externalId: job.externalId,
    title: job.title,
    company: job.company,
    location: job.location,
    url: job.url,
    source: 'linkedin',
    status: 'applied',
    appliedAt: now,
    updatedAt: now,
    dryRun,
    questionsAnswered,
    aiAnswersUsed,
    notes: '',
  }
  await addApplication(application)
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ---------------------------------------------------------------------------
// Watchdog
// ---------------------------------------------------------------------------

/**
 * Restart the loop if the worker was killed while a run was in flight. Chrome's
 * minimum alarm period is one minute, which is far too coarse to drive the loop
 * itself but exactly right for noticing it died.
 */
export function installWatchdog(): void {
  chrome.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 1 })

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === WATCHDOG_ALARM) void ensureLoop()
  })
}

/** Pause a run whose tab was closed, rather than spinning on a dead target. */
export function watchTabs(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    void clearContentFrame(tabId)
    void (async () => {
      const state = await getRunState()
      if (state.tabId === tabId && state.status === 'running') {
        await patchRunState({
          status: 'paused',
          lastError: 'The job tab was closed.',
          lastMessage: 'Paused — tab closed.',
        })
      }
    })()
  })
}
