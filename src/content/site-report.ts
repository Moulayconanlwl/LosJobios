import type { SiteReport } from '@/lib/messaging'
import type { SiteAdapter } from './adapters/types'
import { collectFields } from './fields'

/**
 * Telling the user what this page is, before they act on it.
 *
 * Today the answer to "will this work here?" is only discovered by pressing
 * the button and seeing what happens. That is a poor trade on a real job
 * application: the failure mode of guessing wrong is a half-filled form on a
 * site the extension never understood.
 *
 * Three honest states, and no claim beyond what was actually found on the
 * page. "No form here" is a legitimate, useful answer.
 */

/** Host names worth naming, so the report reads as recognition, not detection. */
const KNOWN_ATS: Array<{ match: RegExp; name: string }> = [
  { match: /(^|\.)linkedin\.com$/, name: 'LinkedIn' },
  { match: /(^|\.)greenhouse\.io$/, name: 'Greenhouse' },
  { match: /(^|\.)lever\.co$/, name: 'Lever' },
  { match: /(^|\.)ashbyhq\.com$/, name: 'Ashby' },
  { match: /(^|\.)myworkdayjobs\.com$/, name: 'Workday' },
  { match: /(^|\.)workday\.com$/, name: 'Workday' },
  { match: /(^|\.)smartrecruiters\.com$/, name: 'SmartRecruiters' },
  { match: /(^|\.)welcometothejungle\.com$/, name: 'Welcome to the Jungle' },
  // Indeed runs one site per country across a mix of subdomains
  // (fr.indeed.com) and country TLDs (indeed.co.uk), plus the separate host
  // its hosted apply form is served from.
  { match: /(^|\.)indeed\.[a-z]{2,3}(\.[a-z]{2})?$/, name: 'Indeed' },
  { match: /(^|\.)apec\.fr$/, name: 'APEC' },
  { match: /(^|\.)francetravail\.fr$/, name: 'France Travail' },
  { match: /(^|\.)hellowork\.com$/, name: 'HelloWork' },
  { match: /(^|\.)teamtailor\.com$/, name: 'Teamtailor' },
  { match: /(^|\.)personio\.de$/, name: 'Personio' },
  { match: /(^|\.)recruitee\.com$/, name: 'Recruitee' },
]

/**
 * What to call a site an adapter actually drives.
 *
 * Checked before the host list, because the adapter's own opinion is what will
 * drive the page — naming anything else would be a promise this doesn't keep.
 */
const ADAPTER_NAMES: Record<string, string> = { linkedin: 'LinkedIn', indeed: 'Indeed' }

function knownSite(hostname: string): string | null {
  return KNOWN_ATS.find((entry) => entry.match.test(hostname))?.name ?? null
}

export function describeSite(adapter: SiteAdapter): SiteReport {
  let hostname = ''
  try {
    hostname = location.hostname
  } catch {
    // A sandboxed frame without a usable location still deserves an answer.
  }

  const fieldCount = collectFields(document).length
  // The adapter's own opinion wins over the host list: it is what will
  // actually drive the page, so naming anything else would be a promise the
  // extension doesn't keep.
  const named = ADAPTER_NAMES[adapter.id] ?? knownSite(hostname)

  if (fieldCount === 0) {
    return {
      kind: 'no-form',
      site: named ?? hostname,
      fieldCount: 0,
      message: named
        ? `${named} recognised, but there's no application form on this page yet. Open a posting and start its application.`
        : 'No application form found on this page. Open the form itself and try again.',
    }
  }

  if (named) {
    return {
      kind: 'known-ats',
      site: named,
      fieldCount,
      message: `${named} recognised — ${fieldCount} field${fieldCount === 1 ? '' : 's'} found. Review what gets filled before anything is written.`,
    }
  }

  return {
    kind: 'generic-form',
    site: hostname || 'this page',
    fieldCount,
    message: `${fieldCount} field${fieldCount === 1 ? '' : 's'} found on a form this extension doesn't know specifically. Everything still goes through review first.`,
  }
}
