import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IndeedAdapter, isIndeedApplyUrl } from '@/content/adapters/indeed'
import type { ApplyContext } from '@/content/adapters/types'
import { defaultProfile, defaultSettings, type Settings } from '@/lib/schema'

/**
 * Indeed differs from LinkedIn in the one way that shapes everything else:
 * applying *navigates*. So the tests that matter most here are the ones about
 * what happens at the boundaries — what the adapter decides before clicking
 * anything, and whether it correctly declines a posting it has no business
 * driving.
 *
 * The rule the whole file is really checking: a run may only ever walk an
 * Indeed-hosted form. An "apply on the company's site" posting, a posting
 * already applied to, and a page showing a human-verification challenge all
 * have to come back as a decision, never as a click.
 */

function context(settings: Partial<Settings> = {}): ApplyContext {
  return {
    profile: defaultProfile(),
    settings: { ...defaultSettings(), ...settings },
    job: null,
    dryRun: true,
    signal: new AbortController().signal,
    jobDescription: '',
    report: () => {},
  }
}

/** One search result, in the shape Indeed's current cards take. */
function card({
  jk,
  title,
  company,
  where = 'Paris (75)',
}: {
  jk: string
  title: string
  company: string
  where?: string
}): string {
  return `
    <div class="job_seen_beacon" data-jk="${jk}">
      <h2 class="jobTitle"><a data-jk="${jk}" href="/rc/clk?jk=${jk}"><span title="${title}">${title}</span></a></h2>
      <span data-testid="company-name">${company}</span>
      <div data-testid="text-location">${where}</div>
    </div>
  `
}

/**
 * The adapter reads `location` for the job key and to tell a listing page from
 * the hosted apply form, so the tests have to be able to move the page.
 */
type HappyDomWindow = Window & { happyDOM?: { setURL?: (href: string) => void } }

function setLocation(href: string): void {
  ;(window as HappyDomWindow).happyDOM?.setURL?.(href)
}

/**
 * Give every element a non-zero box.
 *
 * Nothing is laid out in a test DOM, so every element reports 0×0 — which is
 * exactly what an unpainted background tab reports too. That is a real
 * distinction the adapter depends on: reading text has to work on an
 * unpainted page, while *clicking* legitimately requires a painted target.
 * Painting here is what lets the click paths be exercised at all; the tests
 * that care about the unpainted case turn it back off.
 */
function paintEverything(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 200,
    bottom: 40,
    width: 200,
    height: 40,
    toJSON: () => ({}),
  } as DOMRect)
}

beforeEach(() => {
  document.body.innerHTML = ''
  setLocation('https://fr.indeed.com/jobs?q=developpeur')
  paintEverything()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('matches', () => {
  const adapter = new IndeedAdapter()

  it('claims the country sites, not just indeed.com', () => {
    expect(adapter.matches('https://www.indeed.com/jobs?q=dev')).toBe(true)
    expect(adapter.matches('https://fr.indeed.com/jobs?q=dev')).toBe(true)
    expect(adapter.matches('https://indeed.fr/jobs')).toBe(true)
    expect(adapter.matches('https://uk.indeed.com/jobs')).toBe(true)
    expect(adapter.matches('https://smartapply.indeed.com/beta/indeedapply/form/resume')).toBe(true)
  })

  it('does not claim a lookalike domain', () => {
    // The anchor matters: "notindeed.com" and "indeed.com.evil.test" must not
    // hand an attacker's page a content script with a filled-in profile.
    expect(adapter.matches('https://notindeed.com/jobs')).toBe(false)
    expect(adapter.matches('https://indeed.com.evil.test/jobs')).toBe(false)
    expect(adapter.matches('https://www.linkedin.com/jobs/search')).toBe(false)
  })
})

describe('collectJobs', () => {
  const adapter = new IndeedAdapter()

  it('reads title, company and location off each card', async () => {
    document.body.innerHTML = card({ jk: 'abc123', title: 'Développeur Python', company: 'Acme' })

    const [job] = await adapter.collectJobs(10, context())

    expect(job?.externalId).toBe('abc123')
    expect(job?.title).toBe('Développeur Python')
    expect(job?.company).toBe('Acme')
    expect(job?.location).toBe('Paris (75)')
  })

  it('builds a stable job URL from the key rather than the tracking link', async () => {
    // `/rc/clk?jk=…` is a redirect that carries click-tracking parameters and
    // expires. `/viewjob?jk=…` is the posting, and still resolves later when
    // the dashboard wants to reopen it.
    document.body.innerHTML = card({ jk: 'abc123', title: 'Dev', company: 'Acme' })

    const [job] = await adapter.collectJobs(10, context())

    expect(job?.url).toBe('https://fr.indeed.com/viewjob?jk=abc123')
  })

  it('recovers the job key from the href when the attribute is missing', async () => {
    // Indeed has moved `data-jk` between the card and the link more than once.
    document.body.innerHTML = `
      <div class="job_seen_beacon">
        <h2 class="jobTitle"><a href="/viewjob?jk=fromhref&amp;from=serp"><span title="Dev">Dev</span></a></h2>
      </div>
    `

    const [job] = await adapter.collectJobs(10, context())

    expect(job?.externalId).toBe('fromhref')
  })

  it('deduplicates a card that matches more than one selector', async () => {
    // `.job_seen_beacon` and `div[data-jk]` are both in the selector list and
    // both match the same element on a current layout.
    document.body.innerHTML = card({ jk: 'abc123', title: 'Dev', company: 'Acme' })

    const jobs = await adapter.collectJobs(10, context())

    expect(jobs).toHaveLength(1)
  })

  it('applies the title and company filters', async () => {
    document.body.innerHTML =
      card({ jk: 'a', title: 'Senior Developer', company: 'Acme' }) +
      card({ jk: 'b', title: 'Junior Developer', company: 'Acme' }) +
      card({ jk: 'c', title: 'Junior Developer', company: 'Blocked Ltd' })

    const jobs = await adapter.collectJobs(10, context({
      titleExcludeKeywords: ['senior'],
      blockedCompanies: ['blocked ltd'],
    }))

    expect(jobs.map((j) => j.externalId)).toEqual(['b'])
  })

  it('honours the limit', async () => {
    document.body.innerHTML = ['a', 'b', 'c', 'd']
      .map((jk) => card({ jk, title: 'Dev', company: 'Acme' }))
      .join('')

    expect(await adapter.collectJobs(2, context())).toHaveLength(2)
  })
})

describe('diagnoseEmptyCollection', () => {
  const adapter = new IndeedAdapter()

  it('names a verification challenge rather than blaming the filters', async () => {
    // Telling someone their filters were too narrow when Indeed is actually
    // showing a captcha sends them to change the wrong thing.
    document.body.innerHTML = `<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>`

    expect(adapter.diagnoseEmptyCollection()).toMatch(/verification/i)
  })

  it('distinguishes "no cards at all" from "everything filtered out"', () => {
    document.body.innerHTML = ''
    expect(adapter.diagnoseEmptyCollection()).toMatch(/no job cards/i)

    document.body.innerHTML = card({ jk: 'a', title: 'Dev', company: 'Acme' })
    expect(adapter.diagnoseEmptyCollection()).toMatch(/filtered out/i)
  })
})

describe('apply', () => {
  const adapter = new IndeedAdapter()

  function jobPage(body: string): void {
    setLocation('https://fr.indeed.com/viewjob?jk=abc123')
    document.body.innerHTML = `<div id="jobDescriptionText">${'Description. '.repeat(40)}</div>${body}`
  }

  it('declines a posting that applies on the company’s own site', async () => {
    // The whole point of the run is that it only drives forms it understands.
    jobPage(`<a href="https://careers.acme.test/apply">Apply on company site</a>`)

    const outcome = await adapter.apply(context())

    expect(outcome.result).toBe('skipped')
    expect(outcome).toMatchObject({ reason: expect.stringContaining('own site') })
  })

  it('declines a posting with no apply button at all', async () => {
    jobPage('')

    const outcome = await adapter.apply(context())

    expect(outcome).toMatchObject({ result: 'skipped' })
  })

  it('declines a posting already applied to', async () => {
    jobPage(`<button id="indeedApplyButton">Applied</button>`)

    expect(await adapter.apply(context())).toMatchObject({
      result: 'skipped',
      reason: 'Already applied.',
    })
  })

  it('recognises the French "already applied" wording', async () => {
    // An English-only check silently re-applies to every job on fr.indeed.com,
    // which is worse than failing: it spams the employer.
    jobPage(`<button id="indeedApplyButton">Candidature envoyée</button>`)

    expect(await adapter.apply(context())).toMatchObject({ result: 'skipped' })
  })

  it('stops on a verification challenge instead of clicking through it', async () => {
    jobPage(`
      <iframe src="https://challenges.cloudflare.com/turnstile"></iframe>
      <button id="indeedApplyButton">Apply now</button>
    `)

    const outcome = await adapter.apply(context())

    expect(outcome.result).toBe('failed')
    expect(outcome).toMatchObject({ error: expect.stringMatching(/verification/i) })
  })

  it('clicks Apply and hands off when the page is about to navigate', async () => {
    // No in-page form appears, which is what a navigation looks like from
    // inside the old document.
    jobPage(`<button id="indeedApplyButton">Apply now</button>`)
    const clicked = vi.fn()
    document.getElementById('indeedApplyButton')?.addEventListener('click', clicked)

    const outcome = await adapter.apply(context())

    expect(clicked).toHaveBeenCalled()
    expect(outcome).toMatchObject({ result: 'handoff', questionsAnswered: 0 })
  }, 15_000)
})

describe('describeJob', () => {
  const adapter = new IndeedAdapter()

  it('reads the posting header and the key out of the URL', () => {
    setLocation('https://fr.indeed.com/viewjob?jk=xyz789&from=serp')
    document.body.innerHTML = `
      <h2 data-testid="jobsearch-JobInfoHeader-title">Ingénieur logiciel</h2>
      <div data-testid="inlineHeader-companyName">Acme</div>
    `

    expect(adapter.describeJob()).toMatchObject({
      externalId: 'xyz789',
      title: 'Ingénieur logiciel',
      company: 'Acme',
    })
  })

  it('comes back empty rather than throwing on a page it can’t read', () => {
    document.body.innerHTML = '<p>nothing here</p>'

    expect(adapter.describeJob().title).toBe('')
  })

  it('reads a posting in a tab that was never painted', () => {
    /*
     * This is the exact bug that once broke every downstream feature: the
     * dashboard fetches a posting by opening it in a *background* tab, which
     * Chrome never lays out, so every element reports a 0×0 box. A read path
     * that insists on a painted box returns nothing at all from a page whose
     * content is sitting right there.
     */
    vi.restoreAllMocks() // un-paint: every box is now 0×0, as in a background tab
    setLocation('https://fr.indeed.com/viewjob?jk=xyz789')
    document.body.innerHTML = `
      <h2 data-testid="jobsearch-JobInfoHeader-title">Ingénieur logiciel</h2>
      <div data-testid="inlineHeader-companyName">Acme</div>
    `

    expect(adapter.describeJob()).toMatchObject({ title: 'Ingénieur logiciel', company: 'Acme' })
  })
})

describe('jobDescription', () => {
  const adapter = new IndeedAdapter()

  it('reads a description in a tab that was never painted', () => {
    /*
     * The bug this guards against cost the extension its whole downstream
     * feature set once already: a background tab reports zero-size boxes for
     * every real element and returns '' from innerText, so a visibility test
     * that requires a painted box finds nothing at all.
     */
    document.body.innerHTML = `<div id="jobDescriptionText">Nous recherchons un développeur.</div>`

    expect(adapter.jobDescription()).toBe('Nous recherchons un développeur.')
  })

  it('takes the longest candidate when containers nest', () => {
    document.body.innerHTML = `
      <div class="jobsearch-JobComponent-description">
        Outer text that is longer.
        <div id="jobDescriptionText">Inner.</div>
      </div>
    `

    expect(adapter.jobDescription()).toContain('Outer text')
  })

  it('skips a hidden container', () => {
    document.body.innerHTML = `
      <div id="jobDescriptionText" style="display:none">Hidden but long text here.</div>
      <div class="job-description">Visible.</div>
    `

    expect(adapter.jobDescription()).toBe('Visible.')
  })
})

describe('isIndeedApplyUrl', () => {
  it('recognises the hosted form wherever it is served from', () => {
    expect(isIndeedApplyUrl('https://smartapply.indeed.com/beta/indeedapply/form/resume')).toBe(true)
    expect(isIndeedApplyUrl('https://apply.indeed.com/indeedapply/form')).toBe(true)
    expect(isIndeedApplyUrl('https://fr.indeed.com/applystart?jk=abc')).toBe(true)
  })

  it('does not mistake a search or a posting for the form', () => {
    expect(isIndeedApplyUrl('https://fr.indeed.com/jobs?q=dev')).toBe(false)
    expect(isIndeedApplyUrl('https://fr.indeed.com/viewjob?jk=abc')).toBe(false)
  })

  it('returns false rather than throwing on a malformed URL', () => {
    expect(isIndeedApplyUrl('not a url')).toBe(false)
  })
})
