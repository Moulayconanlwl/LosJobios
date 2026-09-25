import type { AutofillReport, ApplyOutcome } from '@/lib/messaging'
import type { JobRef } from '@/lib/schema'
import { collectFields } from '../fields'
import { fillFields } from '../filler'
import { normalizeText, pick, text } from '../dom/query'
import type { ApplyContext, SiteAdapter } from './types'

/**
 * The catch-all adapter: no knowledge of any particular site, just an
 * understanding of what HTML forms look like.
 *
 * This is what runs on Greenhouse, Lever, Workday, Ashby and the thousand
 * bespoke career pages nobody will ever write a dedicated adapter for. It never
 * submits anything — it fills the form and hands control back to you.
 */

const DESCRIPTION_SELECTORS = [
  '[class*="job-description"]',
  '[class*="jobDescription"]',
  '[data-testid*="description"]',
  '#job-description',
  'article',
  'main',
]

const TITLE_SELECTORS = [
  'h1',
  '[class*="job-title"]',
  '[class*="posting-headline"] h2',
  '[data-testid*="job-title"]',
]

const COMPANY_SELECTORS = [
  '[class*="company-name"]',
  '[class*="companyName"]',
  '[itemprop="hiringOrganization"]',
  'meta[property="og:site_name"]',
]

export class UniversalAdapter implements SiteAdapter {
  readonly id = 'universal'

  /** The fallback — it handles anything nothing else claimed. */
  matches(): boolean {
    return true
  }

  async collectJobs(): Promise<JobRef[]> {
    // There's no generic notion of a job list; universal mode is one page at a time.
    return []
  }

  async openJob(): Promise<boolean> {
    return false
  }

  async apply(ctx: ApplyContext): Promise<ApplyOutcome> {
    // Auto-submitting an unknown form is how you send a half-finished
    // application to a company you wanted. Fill it, then let the human submit.
    const report = await this.autofill(ctx)
    return {
      result: 'skipped',
      reason: `Filled ${report.filled} field${report.filled === 1 ? '' : 's'} — review and submit manually.`,
    }
  }

  jobDescription(): string {
    const el = pick(DESCRIPTION_SELECTORS)
    if (!el) return normalizeText(document.body.innerText).slice(0, 8000)
    return normalizeText(text(el)).slice(0, 8000)
  }

  /** Best-effort job identity, used to label the tracked application. */
  describeJob(): JobRef {
    const titleEl = pick(TITLE_SELECTORS)

    const ogSiteName = document
      .querySelector('meta[property="og:site_name"]')
      ?.getAttribute('content')
    const companyEl = pick(COMPANY_SELECTORS.filter((s) => !s.startsWith('meta')))

    return {
      externalId: location.href.split('?')[0] ?? location.href,
      title: titleEl ? text(titleEl).slice(0, 200) : document.title.slice(0, 200),
      company: normalizeText(companyEl ? text(companyEl) : (ogSiteName ?? location.hostname)),
      location: '',
      url: location.href,
    }
  }

  async autofill(ctx: ApplyContext): Promise<AutofillReport> {
    const fields = collectFields(document)
    ctx.report(`Found ${fields.length} fields on this page.`)

    const summary = await fillFields(fields, ctx)

    return {
      filled: summary.filled,
      skipped: summary.skipped,
      unfilled: summary.unanswered.map((f) => f.label).filter(Boolean),
    }
  }
}
