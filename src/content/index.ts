import { registerHandlers, sendToBackground, type AutofillReport } from '@/lib/messaging'
import { getProfile, getSettings } from '@/lib/storage'
import type { JobRef } from '@/lib/schema'
import { waitFor } from './dom/query'
import { LinkedInAdapter } from './adapters/linkedin'
import { UniversalAdapter } from './adapters/universal'
import type { ApplyContext, SiteAdapter } from './adapters/types'
import { hideOverlay, showOverlay } from './overlay'

/**
 * Content script entry point.
 *
 * Owns three things: which adapter handles this page, the abort signal for
 * whatever operation is in flight, and the status overlay. Everything else is
 * delegated.
 */

const linkedin = new LinkedInAdapter()
const universal = new UniversalAdapter()

function adapterFor(url: string): SiteAdapter {
  try {
    if (linkedin.matches(url)) return linkedin
  } catch {
    // A malformed URL just means we fall through to the universal adapter.
  }
  return universal
}

let adapter = adapterFor(location.href)

/** Aborts the in-flight operation when the run is paused, stopped, or navigates away. */
let controller = new AbortController()

function resetController(): AbortSignal {
  controller.abort()
  controller = new AbortController()
  return controller.signal
}

async function buildContext(job: JobRef | null, dryRun: boolean): Promise<ApplyContext> {
  const [profile, settings] = await Promise.all([getProfile(), getSettings()])

  return {
    profile,
    settings,
    job,
    dryRun,
    signal: controller.signal,
    jobDescription: adapter.jobDescription(),
    report(message: string) {
      showOverlay(message, job ? `${job.title} — ${job.company}` : '')
      void sendToBackground('run/progress', { message }).catch(() => {
        // The popup being closed is not an error worth surfacing.
      })
    },
  }
}

// ---------------------------------------------------------------------------
// SPA navigation
// ---------------------------------------------------------------------------

/**
 * LinkedIn never reloads the page, so `DOMContentLoaded` fires once and never
 * again. Patch the History API and watch for popstate so the adapter and any
 * in-flight work react to moving between jobs.
 */
function watchNavigation(): void {
  let lastUrl = location.href

  const onNavigate = () => {
    if (location.href === lastUrl) return
    lastUrl = location.href
    adapter = adapterFor(location.href)
  }

  for (const method of ['pushState', 'replaceState'] as const) {
    const original = history[method]
    history[method] = function patched(this: History, ...args: Parameters<History['pushState']>) {
      const result = original.apply(this, args)
      queueMicrotask(onNavigate)
      return result
    }
  }

  window.addEventListener('popstate', onNavigate)
}

watchNavigation()

// ---------------------------------------------------------------------------
// Frame claiming
// ---------------------------------------------------------------------------

/**
 * With `all_frames: true`, this script now loads into every frame on the
 * page — including, on sites that split their real content into a
 * same-origin iframe, the empty top-level shell. Each instance checks
 * whether *it* has the actual content and, if so, tells the background,
 * which then addresses future commands to that frame instead of defaulting
 * to frame 0. Sites without an adapter-level `hasAppContent` check (or with
 * no iframe split at all) simply never announce, which is a no-op — messages
 * keep going to frame 0 exactly as before.
 */
async function claimFrameIfContent(): Promise<void> {
  if (typeof adapter.hasAppContent !== 'function') return

  const found = await waitFor(() => (adapter.hasAppContent?.() ? true : null), {
    timeoutMs: 8000,
    intervalMs: 250,
  })
  if (!found) return

  try {
    await sendToBackground('cs/claim-frame')
    console.info('[LosJobios] this frame has the page content — claimed it.')
  } catch {
    // The background waking up late is not worth retrying over — the claim
    // is re-sent on the next page load, and the run falls back to frame 0.
  }
}

void claimFrameIfContent()

// ---------------------------------------------------------------------------
// Message handlers
// ---------------------------------------------------------------------------

registerHandlers({
  'cs/ping': () => ({ ready: true as const, site: adapter.id }),

  'cs/collect-jobs': async ({ limit }) => {
    resetController()
    const ctx = await buildContext(null, true)
    ctx.report('Scanning job list…')
    const jobs = await adapter.collectJobs(limit, ctx)

    if (jobs.length === 0) {
      const reason = adapter.diagnoseEmptyCollection?.()
      ctx.report(reason ?? 'Found 0 matching jobs.')
      return { jobs, emptyReason: reason }
    }

    ctx.report(`Found ${jobs.length} matching jobs.`)
    return { jobs }
  },

  'cs/apply-job': async ({ job, dryRun }) => {
    resetController()

    const opened = await adapter.openJob(job, await buildContext(job, dryRun))
    if (!opened) {
      return { result: 'skipped' as const, reason: 'Could not open the job listing.' }
    }

    // Rebuild the context now that the details pane has rendered, so the job
    // description is actually available for AI question answering.
    const ctx = await buildContext(job, dryRun)
    return adapter.apply(ctx)
  },

  'cs/autofill-page': async (): Promise<AutofillReport> => {
    resetController()
    const ctx = await buildContext(null, true)
    showOverlay('Autofilling this page…')

    const report = await adapter.autofill(ctx)

    showOverlay(
      `Filled ${report.filled} field${report.filled === 1 ? '' : 's'}.`,
      report.unfilled.length ? `Left for you: ${report.unfilled.slice(0, 3).join(', ')}` : '',
    )
    setTimeout(hideOverlay, 6000)

    return report
  },

  /**
   * What job is this page about?
   *
   * The description is waited for rather than read once. A posting opened
   * fresh — which is exactly how the dashboard fetches one — renders its
   * body well after the content script loads, so reading immediately
   * reliably returned nothing at all.
   */
  'cs/job-context': async () => {
    const description = await waitFor(
      () => {
        const text = adapter.jobDescription()
        // A handful of characters is a heading or a spinner, not a posting.
        return text.length > 200 ? text : null
      },
      { timeoutMs: 12_000, intervalMs: 300 },
    )

    const job = adapter.describeJob()

    return {
      title: job.title,
      company: job.company,
      // Fall back to whatever short text there is rather than nothing.
      description: description ?? adapter.jobDescription(),
      url: location.href,
    }
  },

  'cs/abort': () => {
    resetController()
    hideOverlay()
    return { ok: true as const }
  },

  'cs/overlay': ({ visible, status, detail }) => {
    if (visible) showOverlay(status, detail)
    else hideOverlay()
    return { ok: true as const }
  },
})

console.info('[LosJobios] content script ready —', adapter.id)
