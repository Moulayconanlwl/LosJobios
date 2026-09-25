import type { JobSource } from '@/lib/schema'

/**
 * Which URLs the extension will act on by itself.
 *
 * Deliberately a module of its own, with no Chrome API and no DOM: these are
 * the two questions the background has to answer *without* a content script to
 * ask, and both are security boundaries rather than mere routing.
 * `detectJobBoard` decides where a run will scrape and click on its own
 * initiative; `isApplyContinuation` decides where an application already in
 * flight may carry on filling in real personal details unattended. A lookalike
 * domain passing either would hand a hostile page an automated form filler
 * primed with a complete profile — so every host test is anchored at both
 * ends.
 */

/**
 * A job board a run can be started against.
 *
 * `hint` is what the user is told when they press Start on the wrong page, so
 * it names the URL that actually works rather than the site in general.
 */
export type JobBoard = {
  id: Extract<JobSource, 'linkedin' | 'indeed'>
  label: string
  hint: string
  /**
   * True when applying navigates the tab away from the listing, so the run
   * engine has to steer it back between jobs.
   */
  navigatesToApply: boolean
}

const BOARDS: Array<JobBoard & { match(url: URL): boolean }> = [
  {
    id: 'linkedin',
    label: 'LinkedIn',
    hint: 'Open a LinkedIn job search page first (linkedin.com/jobs/search).',
    // Easy Apply is a modal on the page you were already on.
    navigatesToApply: false,
    match: (url) =>
      /(^|\.)linkedin\.com$/.test(url.hostname) && url.pathname.startsWith('/jobs/'),
  },
  {
    id: 'indeed',
    label: 'Indeed',
    hint: 'Open an Indeed search page first (indeed.com/jobs?q=…).',
    // Indeed Apply is a separate page load, which is what the whole handoff
    // path in session.ts exists to survive.
    navigatesToApply: true,
    // Indeed runs one site per country across a mix of subdomains
    // (fr.indeed.com) and country TLDs (indeed.co.uk). `/jobs` is the search,
    // `/viewjob` a single posting, and `/q-…-jobs.html` the SEO-friendly
    // search URL Indeed's own links hand out.
    match: (url) =>
      /(^|\.)indeed\.[a-z]{2,3}(\.[a-z]{2})?$/.test(url.hostname) &&
      /^\/(jobs|viewjob|q-|m\/jobs)/.test(url.pathname),
  },
]

/** Which board this URL belongs to, or null when it isn't one. */
export function detectJobBoard(url: string | null | undefined): JobBoard | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return null

    const board = BOARDS.find((candidate) => candidate.match(parsed))
    if (!board) return null

    const { id, label, hint, navigatesToApply } = board
    return { id, label, hint, navigatesToApply }
  } catch {
    return null
  }
}

/**
 * Does this URL continue an application that started somewhere else?
 *
 * The run engine asks this after losing contact with a tab mid-apply: landing
 * on one of these means the Apply button navigated, not that the user wandered
 * off, and the run should carry on there rather than count a failure.
 *
 * The host test comes first and is absolute. A path containing "indeedapply"
 * on somebody else's domain is not an Indeed form, it is a page claiming to
 * be one.
 */
export function isApplyContinuation(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false

    const indeedHost = /(^|\.)indeed\.[a-z]{2,3}(\.[a-z]{2})?$/.test(parsed.hostname)
    if (!indeedHost) return false

    // The hosted form lives on its own subdomain; older flows served it from
    // a path on the country site.
    if (/^(smartapply|apply)\./.test(parsed.hostname)) return true
    return /indeedapply|applystart|\/apply\//.test(parsed.pathname)
  } catch {
    return false
  }
}
