import { resolveAnswer } from '@/lib/answers'
import { registerHandlers, sendToTab } from '@/lib/messaging'
import { savedJobDefaults } from '@/lib/schema'
import {
  addScrapedJobs,
  getRunState,
  getSavedJobs,
  logActivity,
  patchRunState,
  putSavedJob,
  runMigrations,
  setCapturedJob,
} from '@/lib/storage'
import { claimContentFrame, resolveContentFrame } from './frames'
import { clearLog, log, logInfo, readLog } from '@/lib/debug-log'
import { extractDescription } from '@/lib/extract-description'
import { detectJobBoard } from './boards'
import { ensureContentScript, getActiveTab, isInjectable } from './injector'
import {
  answerPending,
  ensureLoop,
  installWatchdog,
  pauseRun,
  resumeRun,
  startRun,
  stopRun,
  watchTabs,
} from './session'

/**
 * Service worker entry point.
 *
 * Everything here must be registered synchronously at top level. Chrome tears
 * this worker down constantly and re-runs this file on the next event — a
 * listener registered inside an `await` may simply not exist when the event
 * that needed it arrives.
 */

const DASHBOARD_PAGE = 'src/ui/dashboard/index.html'

/** Host only — a full URL in a log would carry query parameters with it. */
function hostOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/**
 * Get a live content script in the tab the user is looking at, and the frame
 * worth addressing in it.
 *
 * Every side-panel action needs the same four steps, and each has its own
 * failure the panel should be able to explain rather than just fail on.
 */
async function reachActiveTab(): Promise<
  { tabId: number; frameId: number | undefined } | { error: string }
> {
  const tab = await getActiveTab()
  if (!tab?.id) return { error: 'No active tab.' }

  if (!isInjectable(tab.url)) {
    return { error: 'This kind of page can’t be read — open the application form itself.' }
  }

  if (!(await ensureContentScript(tab.id))) {
    return { error: 'Could not reach the page. Reload it and try again.' }
  }

  return { tabId: tab.id, frameId: await resolveContentFrame(tab.id) }
}

/** Let a freshly created tab finish loading before anything is asked of it. */
async function waitForTabLoad(tabId: number, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => null)
    if (!tab || tab.status === 'complete') return
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}

/**
 * Read a posting's description out of every frame of a tab, without going
 * through the content script at all.
 *
 * This exists because the messaging path has several independent ways to
 * come back empty — the script not injected yet, the wrong frame addressed,
 * the page not rendered — and a user pressing "Fetch description" doesn't
 * care which one it was. `scripting` + `allFrames` sidesteps the lot: it
 * runs in every frame and the longest answer wins. It polls because the
 * posting body renders after the document is otherwise complete.
 */
async function scrapeDescription(tabId: number, timeoutMs = 12_000): Promise<string> {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    // The greedy fallback is only allowed near the end, so a page that simply
    // has not rendered its description yet is given the whole window to do so
    // before anything cruder is tried.
    const allowFallback = Date.now() > deadline - 2500
    let results: chrome.scripting.InjectionResult<string>[] = []

    try {
      results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        args: [allowFallback],
        // `extractDescription` closes over nothing, which is what lets it be
        // serialized into the page. See the note on it.
        func: extractDescription,
      })
    } catch {
      return '' // no host permission for this site, or the tab went away
    }

    const best = results
      .map((entry) => (typeof entry.result === 'string' ? entry.result : ''))
      .sort((a, b) => b.length - a.length)[0]

    if (best && best.length > 200) return best
    await new Promise((resolve) => setTimeout(resolve, 600))
  }

  return ''
}

registerHandlers({
  'run/start': ({ spec }) => startRun(spec),
  'run/log': async () => ({ entries: await readLog() }),
  'run/log-clear': async () => {
    await clearLog()
    return { ok: true as const }
  },
  'run/pause': () => pauseRun(),
  'run/resume': () => resumeRun(),
  'run/stop': () => stopRun(),
  'run/state': () => getRunState(),
  'run/answer': ({ answer, remember }) => answerPending(answer, remember),

  'run/progress': async ({ message }) => {
    // Progress lines are also the coarse narration of a run, so they land in
    // the log as well as in the status line. The status line shows one; the
    // log keeps all of them.
    void logInfo('worker', message)
    await patchRunState({ lastMessage: message })
    return { ok: true as const }
  },

  'cs/log': async ({ level, scope, message, detail }) => {
    await log(level, scope, message, detail)
    return { ok: true as const }
  },

  'answers/resolve': (request) => resolveAnswer(request),

  'dashboard/open': async () => {
    await chrome.tabs.create({ url: chrome.runtime.getURL(DASHBOARD_PAGE) })
    return { ok: true as const }
  },

  /**
   * Fill the form on whatever page the user is looking at.
   *
   * This runs off a click in the popup, which is the user gesture that makes
   * `activeTab` grant access to a site we otherwise have no permission for.
   */
  'autofill/active-tab': async () => {
    const tab = await getActiveTab()
    if (!tab?.id) return { ok: false as const, error: 'No active tab.' }

    if (!isInjectable(tab.url)) {
      return { ok: false as const, error: 'This page can’t be autofilled.' }
    }

    const ready = await ensureContentScript(tab.id)
    if (!ready) {
      return { ok: false as const, error: 'Could not reach the page. Try reloading it.' }
    }

    // Addressed to the frame that claimed the page's content, not frame 0:
    // on a signed-in LinkedIn job the Easy Apply modal lives inside the app
    // iframe, and filling the top-level shell finds no fields at all.
    const frameId = await resolveContentFrame(tab.id)
    const report = await sendToTab(tab.id, 'cs/autofill-page', {}, { frameId })
    return { ok: true as const, report }
  },

  /**
   * Scrape the posting the user is looking at, for the ATS scorer to pick up
   * on the options page. Same activeTab-plus-gesture route as autofill.
   */
  'ats/capture-job': async () => {
    const tab = await getActiveTab()
    if (!tab?.id) return { ok: false as const, error: 'No active tab.' }

    if (!isInjectable(tab.url)) {
      return { ok: false as const, error: 'This page can’t be read.' }
    }

    const ready = await ensureContentScript(tab.id)
    if (!ready) {
      return { ok: false as const, error: 'Could not reach the page. Try reloading it.' }
    }

    const frameId = await resolveContentFrame(tab.id)
    const context = await sendToTab(tab.id, 'cs/job-context', {}, { frameId })

    if (!context.description.trim()) {
      return {
        ok: false as const,
        error: 'No job description found on this page. Open the posting itself, then try again.',
      }
    }

    const job = {
      title: context.title,
      company: context.company,
      description: context.description,
      url: context.url,
      capturedAt: Date.now(),
    }
    await setCapturedJob(job)

    // A posting read in full is worth keeping — this is the one path that
    // captures a description without opening anything extra.
    await addScrapedJobs([
      {
        ...savedJobDefaults(),
        id: crypto.randomUUID(),
        title: context.title,
        company: context.company,
        url: context.url,
        description: context.description,
        // Tag it with the board when the URL is one, so the dashboard's
        // already-applied check and its source filter agree with what a run
        // would have recorded for the same posting.
        source: detectJobBoard(tab.url)?.id ?? ('universal' as const),
        savedAt: Date.now(),
      },
    ])

    return { ok: true as const, job }
  },

  'panel/site-report': async () => {
    const target = await reachActiveTab()
    if ('error' in target) return { ok: false as const, error: target.error }

    const site = await sendToTab(target.tabId, 'cs/site-report', {}, { frameId: target.frameId })
    return { ok: true as const, site }
  },

  'panel/plan-fields': async () => {
    const target = await reachActiveTab()
    if ('error' in target) return { ok: false as const, error: target.error }

    const plan = await sendToTab(target.tabId, 'cs/plan-fields', {}, { frameId: target.frameId })
    return { ok: true as const, plan }
  },

  'panel/draft-answers': async () => {
    const target = await reachActiveTab()
    if ('error' in target) return { ok: false as const, error: target.error }

    const { proposals } = await sendToTab(
      target.tabId,
      'cs/draft-answers',
      {},
      { frameId: target.frameId },
    )
    return { ok: true as const, proposals }
  },

  'panel/apply-plan': async ({ decisions }) => {
    const target = await reachActiveTab()
    if ('error' in target) return { ok: false as const, error: target.error }

    const result = await sendToTab(
      target.tabId,
      'cs/apply-plan',
      { decisions },
      { frameId: target.frameId },
    )

    // The labels of what was filled, never the values — see lib/activity.ts.
    void logActivity({
      kind: 'fields-filled',
      summary: `Filled ${result.filled} reviewed field${result.filled === 1 ? '' : 's'}${
        result.skipped.length ? `, left ${result.skipped.length} alone` : ''
      }.`,
      site: hostOf((await getActiveTab())?.url),
    })

    return { ok: true as const, result }
  },

  /**
   * Scrape the job list the user is looking at into the saved-jobs library,
   * without applying to anything. This is how a posting gets into the
   * dashboard to have materials written for it.
   */
  'jobs/scan-active-tab': async () => {
    const tab = await getActiveTab()
    if (!tab?.id) return { ok: false as const, error: 'No active tab.' }

    if (!isInjectable(tab.url)) {
      return { ok: false as const, error: 'This page can’t be scanned.' }
    }

    const ready = await ensureContentScript(tab.id)
    if (!ready) {
      return { ok: false as const, error: 'Could not reach the page. Try reloading it.' }
    }

    const frameId = await resolveContentFrame(tab.id)
    const { jobs, emptyReason } = await sendToTab(tab.id, 'cs/collect-jobs', { limit: 100 }, { frameId })

    if (!jobs.length) {
      return { ok: false as const, error: emptyReason ?? 'No jobs found on this page.' }
    }

    const now = Date.now()
    const added = await addScrapedJobs(
      jobs.map((job) => ({
        ...savedJobDefaults(),
        id: crypto.randomUUID(),
        externalId: job.externalId,
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        source: detectJobBoard(tab.url)?.id ?? ('universal' as const),
        savedAt: now,
      })),
    )

    return { ok: true as const, added, found: jobs.length }
  },

  /**
   * Read one posting's description by opening it in a background tab.
   *
   * The tab is created inactive so it doesn't steal focus, and closed again
   * whatever happens — an orphaned tab per job would be worse than no
   * description at all.
   */
  'jobs/fetch-description': async ({ id }) => {
    const job = (await getSavedJobs()).find((entry) => entry.id === id)
    if (!job) return { ok: false as const, error: 'That job is no longer saved.' }
    if (!job.url) return { ok: false as const, error: 'That job has no link to open.' }

    let tabId: number | undefined

    try {
      const tab = await chrome.tabs.create({ url: job.url, active: false })
      tabId = tab.id
      if (tabId === undefined) return { ok: false as const, error: 'Could not open the posting.' }

      // `tabs.create` resolves while the tab is still loading. Injecting into
      // a document that's about to be replaced by the navigation was one of
      // the reasons this came back empty.
      await waitForTabLoad(tabId)

      let description = ''
      let title = ''
      let company = ''

      // Preferred path: the content script, which knows this site's layouts
      // and waits for the posting to render. The frame claim is waited for
      // because the tab is seconds old — on a signed-in LinkedIn the real
      // document is an iframe, and frame 0 is an empty shell.
      if (await ensureContentScript(tabId)) {
        try {
          const frameId = await resolveContentFrame(tabId, 6000)
          const context = await sendToTab(tabId, 'cs/job-context', {}, { frameId })
          description = context.description.trim()
          title = context.title
          company = context.company
        } catch {
          // Fall through to reading the page directly.
        }
      }

      // Fallback: read every frame ourselves. Independent of the content
      // script, the frame claim and the messaging layer, so it still works
      // when any one of those is the thing that's broken.
      if (!description) description = await scrapeDescription(tabId)

      if (!description) {
        return {
          ok: false as const,
          error: 'Could not read a description from that posting. Open it yourself and use “Score this job against my CV” in the popup instead.',
        }
      }

      await putSavedJob({
        ...job,
        description,
        title: job.title || title,
        company: job.company || company,
      })

      return { ok: true as const, description }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    } finally {
      if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => {})
    }
  },

  'cs/claim-frame': async (_, sender) => {
    if (sender.tab?.id !== undefined && sender.frameId !== undefined) {
      await claimContentFrame(sender.tab.id, sender.frameId)
    }
    return { ok: true as const }
  },
})

/*
 * Note: there is deliberately no "clear the claim on navigation" listener
 * here. An earlier version cleared on `changeInfo.status === 'loading'`,
 * which looked prudent but actively broke things — LinkedIn fires `loading`
 * for its own URL normalization right after load, and again every time the
 * run clicks into a job, wiping a perfectly valid claim mid-run and sending
 * everything back to frame 0.
 *
 * Staleness is self-healing instead: every fresh page load re-announces,
 * overwriting the claim with the current frame, and a claim pointing at a
 * frame that no longer exists simply fails to send and is re-resolved (see
 * `resolveContentFrame` in session.ts). Tab close still clears, in watchTabs.
 */

chrome.runtime.onInstalled.addListener((details) => {
  void (async () => {
    await runMigrations()
    // Send first-time users straight to the profile editor — nothing works
    // until it's filled in, and a silent no-op is a terrible first impression.
    if (details.reason === 'install') {
      await chrome.runtime.openOptionsPage()
    }
  })()
})

chrome.runtime.onStartup.addListener(() => {
  void ensureLoop()
})

/**
 * The panel is opened from the popup rather than by replacing it.
 *
 * `chrome.sidePanel.open` has to be called inside a user gesture, and the
 * popup click is one. Keeping the popup as the run cockpit and the panel as
 * the review workspace means neither surface has to be both.
 */
registerHandlers({
  'panel/open': async (_, sender) => {
    try {
      const tabId = sender.tab?.id ?? (await getActiveTab())?.id
      if (tabId === undefined) return { ok: false as const, error: 'No active tab.' }

      await chrome.sidePanel.open({ tabId })
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  },
})

/**
 * Open the side panel when the toolbar icon is clicked.
 *
 * Registered unconditionally at top level, like every other listener here: the
 * worker is torn down constantly, and this must exist the moment the click
 * arrives. `setPanelBehavior` only works while the action has no
 * `default_popup`, which is why the manifest declares none.
 */
chrome.sidePanel
  ?.setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => console.warn('[LosJobios] could not set panel behavior', err))

installWatchdog()
watchTabs()
