import { resolveAnswer } from '@/lib/answers'
import { registerHandlers, sendToTab } from '@/lib/messaging'
import { getRunState, patchRunState, runMigrations, setCapturedJob } from '@/lib/storage'
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

    return { ok: true as const, job }
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
