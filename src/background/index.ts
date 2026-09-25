import { resolveAnswer } from '@/lib/answers'
import { registerHandlers, sendToTab } from '@/lib/messaging'
import { savedJobDefaults } from '@/lib/schema'
import {
  addScrapedJobs,
  getRunState,
  getSavedJobs,
  patchRunState,
  putSavedJob,
  runMigrations,
  setCapturedJob,
} from '@/lib/storage'
import { claimContentFrame, resolveContentFrame } from './frames'
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
    let results: chrome.scripting.InjectionResult<string>[] = []

    try {
      results = await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        // Self-contained on purpose: this is serialized into every frame, so
        // it can close over nothing from up here.
        func: () => {
          const selectors = [
            '#job-details',
            '.jobs-description__content',
            '.jobs-description-content__text',
            '.jobs-box__html-content',
            '.show-more-less-html__markup',
            '.description__text',
            '[class*="jobs-description"]',
            '[class*="description__text"]',
            'article',
            'main',
          ]

          let best = ''
          for (const selector of selectors) {
            for (const el of Array.from(document.querySelectorAll(selector))) {
              const node = el as HTMLElement
              // textContent as the fallback: innerText depends on layout and
              // is empty in a tab that was never painted.
              const text = (node.innerText || node.textContent || '')
                .replace(/\s+/g, ' ')
                .trim()
              if (text.length > best.length) best = text
            }
            // A specific selector that matched well enough is better than a
            // longer but vaguer match from `main`, so stop early.
            if (best.length > 400) return best.slice(0, 8000)
          }
          return best.slice(0, 8000)
        },
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
  'run/start': () => startRun(),
  'run/pause': () => pauseRun(),
  'run/resume': () => resumeRun(),
  'run/stop': () => stopRun(),
  'run/state': () => getRunState(),
  'run/answer': ({ answer, remember }) => answerPending(answer, remember),

  'run/progress': async ({ message }) => {
    await patchRunState({ lastMessage: message })
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
        source: tab.url?.includes('linkedin.com') ? ('linkedin' as const) : ('universal' as const),
        savedAt: Date.now(),
      },
    ])

    return { ok: true as const, job }
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
        source: 'linkedin' as const,
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

installWatchdog()
watchTabs()
