import { rememberUserAnswer } from '@/lib/answers'
import { NoReceiverError, sendToTab, type Ack, type ApplyOutcome } from '@/lib/messaging'
import type { Application, JobRef, RunState } from '@/lib/schema'
import {
  addApplication,
  addScrapedJobs,
  appliedExternalIds,
  logActivity,
  getRunState,
  getSettings,
  patchRunState,
  setRunState,
} from '@/lib/storage'
import { defaultRunState, savedJobDefaults } from '@/lib/schema'
import type { JobSource } from '@/lib/schema'
import { logError, logInfo, logWarn } from '@/lib/debug-log'
import { buildSearchUrl, type SearchSpec } from '@/lib/search-url'
import { detectJobBoard, isApplyContinuation } from './boards'
import { clearContentFrame, resolveContentFrame } from './frames'
import { ensureContentScript, getActiveTab } from './injector'

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

/**
 * Start a run.
 *
 * With a `spec`, the run goes and finds the search itself: it builds the
 * board's own search URL from the role and filters, navigates a tab there and
 * waits for it to load. Without one, it uses whatever search the active tab is
 * already showing.
 *
 * The spec path is the one that matters. Demanding the user already be on a
 * correctly-filtered search page is a strange thing to ask when the extension
 * knows the role and every board encodes its search in the URL — and it is
 * the reason starting a run "did nothing" from anywhere else.
 */
export async function startRun(spec?: SearchSpec): Promise<Ack> {
  const existing = await getRunState()
  if (existing.status === 'running') return { ok: false, error: 'A run is already in progress.' }

  const tab = await getActiveTab()
  if (!tab?.id) return { ok: false, error: 'No active tab.' }

  let boardUrl = tab.url ?? ''

  if (spec) {
    let target: string
    try {
      target = buildSearchUrl(spec)
    } catch (err) {
      return { ok: false, error: describeError(err) }
    }

    void logInfo('run', `Opening the ${spec.platform} search`, hostOf(target))

    try {
      await chrome.tabs.update(tab.id, { url: target })
    } catch (err) {
      return { ok: false, error: `Could not open the search page: ${describeError(err)}` }
    }

    const landed = await waitForTabSettled(tab.id, CONTINUATION_LOAD_MS)
    if (!landed) return { ok: false, error: 'The search page never finished loading.' }

    boardUrl = landed
  }

  const board = detectJobBoard(boardUrl)
  if (!board) {
    void logError('run', 'Not a supported job search', hostOf(boardUrl))
    return {
      ok: false,
      error:
        'This page isn’t a supported job search. Type a role above and press Start, or open a LinkedIn or Indeed search yourself.',
    }
  }

  const ready = await ensureContentScript(tab.id)
  if (!ready) return { ok: false, error: 'Could not reach the page. Try reloading it.' }

  // A run is worthless against the wrong frame, so this one waits for a
  // claim rather than falling straight back to frame 0.
  const frameId = await resolveContentFrame(tab.id, 8000)

  const settings = await getSettings()
  const fresh = await withFreshDailyCount({ ...defaultRunState(), ...existing })

  const dailyRemaining = settings.dailyCap - fresh.dailyCount
  if (dailyRemaining <= 0) {
    return { ok: false, error: `Daily cap of ${settings.dailyCap} already reached.` }
  }

  // Two independent limits, and the tighter one wins: the daily cap is a
  // standing safety limit, `maxPerRun` is "how many do I want right now".
  const remaining = spec ? Math.min(dailyRemaining, spec.maxPerRun) : dailyRemaining

  await setRunState({
    ...defaultRunState(),
    status: 'running',
    tabId: tab.id,
    frameId: frameId ?? null,
    board: board.id,
    // Only stored for boards that navigate away to apply — it is what the run
    // steers back to between jobs, and there is nothing to steer back to on a
    // board whose flow never leaves the page.
    boardUrl: board.navigatesToApply ? boardUrl : '',
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
    void logInfo('run', `Collected ${scrapedCount} job(s) from ${board.label}`)

    // The content script already knows the specific reason (signed out,
    // nothing on the page matched at all, everything failed the keyword
    // filters) — that's always more useful than a generic message.
    if (scrapedCount === 0 && response.emptyReason) {
      await patchRunState({ status: 'idle', lastError: response.emptyReason })
      return { ok: false, error: response.emptyReason }
    }
  } catch (err) {
    void logError('run', 'Collecting jobs failed', describeError(err))
    await patchRunState({ status: 'idle', lastError: describeError(err) })
    return { ok: false, error: describeError(err) }
  }

  // Everything the run saw goes into the library too, so the dashboard can
  // write materials for a job whether or not the run got to it.
  if (jobs.length) {
    const now = Date.now()
    void addScrapedJobs(
      jobs.map((job) => ({
        ...savedJobDefaults(),
        id: crypto.randomUUID(),
        externalId: job.externalId,
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        source: board.id,
        savedAt: now,
      })),
    ).catch(() => {
      // Saving for later must never be what fails a run.
    })
  }

  if (settings.skipAlreadyApplied) {
    // Scoped to this board: the same job posted on two boards carries two
    // different ids, and treating one as the other would silently skip a job
    // that was never applied to.
    const already = await appliedExternalIds(board.id)
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

  void logActivity({
    kind: 'run-started',
    summary: `Queued ${jobs.length} job${jobs.length === 1 ? '' : 's'} from a ${board.label} search.`,
    site: hostOf(tab.url),
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

    // The previous job may have left the tab on a confirmation page. Get back
    // to the listing before trying to open anything from it.
    if (state.boardUrl) {
      const returned = await returnToBoard(state.tabId, state.boardUrl)
      if (!returned) {
        await patchRunState({
          status: 'paused',
          lastError: 'Could not get back to the search page. Reopen it and resume.',
        })
        return
      }
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
  let outcome: ApplyOutcome

  try {
    outcome = await sendToTab(tabId, 'cs/apply-job', { job, dryRun }, { frameId: frameId ?? undefined })
  } catch (err) {
    if (err instanceof NoReceiverError) {
      /*
       * Losing the receiver mid-apply means one of two things, and they need
       * opposite responses: the Apply button navigated the tab to a hosted
       * form (carry on there) or the user navigated away (stop).
       *
       * Where the tab actually is answers it. This has to be checked here
       * rather than trusted to the `handoff` reply, because on a fast
       * navigation the page is torn down before the reply is delivered — the
       * reply is the tidy path, not a guarantee.
       */
      const landed = await currentTabUrl(tabId)
      if (isApplyContinuation(landed)) {
        outcome = { result: 'handoff', questionsAnswered: 0, aiAnswersUsed: 0 }
      } else {
        await patchRunState({
          status: 'paused',
          lastError: 'Lost the page. Reopen the job search and resume.',
        })
        return false
      }
    } else {
      await bumpCounter('failed', describeError(err))
      await advanceCursor()
      return true
    }
  }

  if (outcome.result === 'handoff') {
    outcome = await continueOnNewPage(tabId, job, dryRun, outcome)
  }

  switch (outcome.result) {
    case 'applied': {
      const { board } = await getRunState()
      await recordApplication(board, job, dryRun, outcome.questionsAnswered, outcome.aiAnswersUsed)

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
      void logWarn('run', 'Waiting for you to answer a question', outcome.question.question)
      await patchRunState({
        status: 'blocked',
        pendingQuestion: outcome.question,
        lastMessage: 'Waiting on you to answer a question.',
      })
      notifyBlocked(outcome.question.question, job)
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

// ---------------------------------------------------------------------------
// Applications that continue on another page
// ---------------------------------------------------------------------------

/** How long to give a hosted apply form to load before calling it a failure. */
const CONTINUATION_LOAD_MS = 20_000

type SettledOutcome = Exclude<ApplyOutcome, { result: 'handoff' }>

/**
 * Carry an application onto the page the Apply button navigated to.
 *
 * Deliberately one hop and no retries. A second handoff would mean the hosted
 * form navigated again, which is not a flow this understands, and looping on
 * it against a live site is how you end up submitting something twice.
 */
async function continueOnNewPage(
  tabId: number,
  job: JobRef,
  dryRun: boolean,
  carried: { questionsAnswered: number; aiAnswersUsed: number },
): Promise<SettledOutcome> {
  await patchRunState({ lastMessage: 'Following the application to the employer form…' })

  const landed = await waitForTabSettled(tabId, CONTINUATION_LOAD_MS)
  if (!landed) {
    return { result: 'failed', error: 'The application form never finished loading.' }
  }

  if (!isApplyContinuation(landed)) {
    return {
      result: 'failed',
      error: `The apply button led to ${hostOf(landed)}, which isn’t a form this can drive. Finish that one yourself.`,
    }
  }

  const ready = await ensureContentScript(tabId)
  if (!ready) {
    return { result: 'failed', error: 'Could not reach the application form.' }
  }

  // A fresh page load means a fresh frame layout, so any frame claimed for the
  // listing page is stale. Let the claim re-run rather than addressing a frame
  // that no longer exists.
  await clearContentFrame(tabId)
  const frameId = await resolveContentFrame(tabId, 4000)

  try {
    const outcome = await sendToTab(
      tabId,
      'cs/continue-apply',
      {
        job,
        dryRun,
        carried: {
          questionsAnswered: carried.questionsAnswered,
          aiAnswersUsed: carried.aiAnswersUsed,
        },
      },
      { frameId: frameId ?? undefined },
    )

    // A second handoff is not a flow this understands — say so rather than
    // recursing.
    if (outcome.result === 'handoff') {
      return {
        result: 'failed',
        error: 'The application moved on again to a page this can’t follow. Finish that one yourself.',
      }
    }
    return outcome
  } catch (err) {
    if (err instanceof NoReceiverError) {
      return { result: 'failed', error: 'Lost the application form mid-way through.' }
    }
    return { result: 'failed', error: describeError(err) }
  }
}

/**
 * Steer a tab back to the listing page.
 *
 * Navigating to the stored URL rather than going back through history: the
 * confirmation page a hosted form lands on is often reached by redirect, so
 * "back" can mean the form again, or the click that started it.
 *
 * A no-op when the tab is already on that page, which is the normal case —
 * this only has work to do after an application that navigated away.
 */
async function returnToBoard(tabId: number, boardUrl: string): Promise<boolean> {
  const current = await currentTabUrl(tabId)
  if (!current) return false
  if (sameDocument(current, boardUrl)) return true

  try {
    await chrome.tabs.update(tabId, { url: boardUrl })
  } catch {
    return false
  }

  const landed = await waitForTabSettled(tabId, CONTINUATION_LOAD_MS)
  if (!landed || !sameDocument(landed, boardUrl)) return false

  return ensureContentScript(tabId)
}

/** Same page ignoring the fragment, which never changes what was served. */
function sameDocument(a: string, b: string): boolean {
  try {
    const left = new URL(a)
    const right = new URL(b)
    return left.origin === right.origin && left.pathname === right.pathname && left.search === right.search
  } catch {
    return a === b
  }
}

/**
 * Wait for a tab to stop loading, and report where it ended up.
 *
 * Polls rather than listening for `onUpdated`, because an MV3 worker can be
 * torn down and restarted between the listener being attached and the event
 * firing — a poll picks up wherever the tab actually is.
 */
async function waitForTabSettled(tabId: number, timeoutMs: number): Promise<string | null> {
  const deadline = Date.now() + timeoutMs

  for (;;) {
    let tab: chrome.tabs.Tab
    try {
      tab = await chrome.tabs.get(tabId)
    } catch {
      return null // The tab is gone.
    }

    if (tab.status === 'complete' && tab.url) return tab.url
    if (Date.now() >= deadline) return tab.url ?? null

    await sleep(400)
  }
}

async function currentTabUrl(tabId: number): Promise<string | null> {
  try {
    const tab = await chrome.tabs.get(tabId)
    return tab.url ?? null
  } catch {
    return null
  }
}

/** A URL reduced to its host, for log lines that shouldn't carry query strings. */
function hostOf(url: string | null | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}


/**
 * Tell the user the run is waiting, even if the panel is closed.
 *
 * A blocked run waits indefinitely by design — the alternative is guessing an
 * answer that goes to a real employer under the user's name — so the queue can
 * sit stalled for hours unless something reaches them outside the panel.
 *
 * The question text is included because it is the employer's own wording, not
 * anything the user typed. Their *answer* never leaves the answer bank.
 */
function notifyBlocked(question: string, job: JobRef): void {
  try {
    chrome.notifications?.create(`losjobios-blocked-${Date.now()}`, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title: 'LosJobios needs an answer',
      message: question.slice(0, 180),
      contextMessage: [job.title, job.company].filter(Boolean).join(' — ').slice(0, 100),
      priority: 2,
      requireInteraction: true,
    })
  } catch {
    // Notifications are a courtesy; the panel still shows the question.
  }
}

async function advanceCursor(): Promise<void> {
  const state = await getRunState()
  await patchRunState({ cursor: state.cursor + 1, currentJob: null })
}

async function bumpCounter(field: 'skipped' | 'failed', message: string): Promise<void> {
  void logWarn('run', field === 'failed' ? 'Job failed' : 'Job skipped', message)
  const state = await getRunState()
  await patchRunState({
    [field]: state[field] + 1,
    lastMessage: message,
    ...(field === 'failed' ? { lastError: message } : {}),
  })
}

async function recordApplication(
  source: JobSource,
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
    source,
    status: 'applied',
    appliedAt: now,
    updatedAt: now,
    dryRun,
    questionsAnswered,
    aiAnswersUsed,
    notes: '',
    followUpOn: '',
    nextAction: '',
  }
  await addApplication(application)

  // Labels and counts only — never the answers that were given.
  void logActivity({
    kind: 'applied',
    summary: dryRun
      ? `Dry run completed, nothing submitted. ${questionsAnswered} field(s) filled.`
      : `Application submitted. ${questionsAnswered} field(s) filled, ${aiAnswersUsed} AI-drafted.`,
    jobTitle: job.title,
    company: job.company,
    site: hostOf(job.url),
  })
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
