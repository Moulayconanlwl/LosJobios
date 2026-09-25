import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  INDEED_APPLY_FILTER,
  buildSearchUrl,
  emptyFilters,
  indeedHost,
  marketFromBrowser,
  resolveMarket,
  type SearchSpec,
} from '@/lib/search-url'

/**
 * Turning "what job do you want" into a board search URL.
 *
 * This is what lets a run start from anywhere rather than demanding the user
 * already be sitting on a correctly-filtered search page. It is also the one
 * place where a small mistake is invisible and total: a malformed facet or the
 * wrong country host returns *zero* results, which looks exactly like the
 * extension being broken rather than like a search being too narrow.
 */

function spec(patch: Partial<SearchSpec> = {}): SearchSpec {
  return {
    platform: 'indeed',
    role: 'product owner',
    market: 'auto',
    filters: emptyFilters(),
    easyApplyOnly: true,
    maxPerRun: 3,
    ...patch,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('resolveMarket', () => {
  it('honours an explicit market over the location text', () => {
    expect(resolveMarket('uk', 'Paris, France')).toBe('uk')
  })

  it('reads the country out of a location', () => {
    expect(resolveMarket('auto', 'Paris')).toBe('fr')
    expect(resolveMarket('auto', 'London, United Kingdom')).toBe('uk')
    expect(resolveMarket('auto', 'New York, NY')).toBe('us')
    expect(resolveMarket('auto', 'Berlin')).toBe('de')
  })

  it('falls back rather than guessing at a location it does not know', () => {
    // A confident wrong guess sends the entire run to another country's site,
    // where the search returns almost nothing.
    expect(resolveMarket('auto', 'Somewhereville', 'fr')).toBe('fr')
    expect(resolveMarket('auto', '', 'uk')).toBe('uk')
  })
})

describe('marketFromBrowser', () => {
  it('reads the region', () => {
    vi.stubGlobal('chrome', { i18n: { getUILanguage: () => 'fr-FR' } })
    expect(marketFromBrowser()).toBe('fr')
  })

  it('falls back to the language when there is no region', () => {
    vi.stubGlobal('chrome', { i18n: { getUILanguage: () => 'de' } })
    expect(marketFromBrowser()).toBe('de')
  })

  it('survives chrome.i18n being unavailable', () => {
    vi.stubGlobal('chrome', {})
    expect(marketFromBrowser()).toBeTruthy()
  })
})

describe('indeedHost', () => {
  it('maps each market to its country site', () => {
    // France is an addition: the reference covers uk/us/ca/au only, and
    // searching uk.indeed.com for a job in Paris returns almost nothing.
    expect(indeedHost('fr')).toBe('fr.indeed.com')
    expect(indeedHost('uk')).toBe('uk.indeed.com')
    expect(indeedHost('us')).toBe('www.indeed.com')
  })
})

describe('buildSearchUrl — Indeed', () => {
  it('builds a search on the country site for the location', () => {
    const url = new URL(
      buildSearchUrl(spec({ filters: { ...emptyFilters(), location: 'Paris' } }), 'uk'),
    )

    expect(url.hostname).toBe('fr.indeed.com')
    expect(url.pathname).toBe('/jobs')
    expect(url.searchParams.get('q')).toBe('product owner')
    expect(url.searchParams.get('l')).toBe('Paris')
  })

  it('applies Indeed’s own Indeed-Apply facet', () => {
    // So the results come back already limited to postings a run can finish,
    // rather than opening jobs one at a time to discover they apply elsewhere.
    const url = new URL(buildSearchUrl(spec(), 'fr'))
    expect(url.searchParams.get('sc')).toBe(INDEED_APPLY_FILTER)
  })

  it('omits the facet when the user turns it off', () => {
    const url = new URL(buildSearchUrl(spec({ easyApplyOnly: false }), 'fr'))
    expect(url.searchParams.get('sc')).toBeNull()
  })

  it('never puts work type or experience into Indeed’s sc parameter', () => {
    /*
     * Indeed encodes those as opaque `attr(…)` codes inside the *same*
     * parameter as the Indeed Apply facet, and the codes differ per country
     * site. A guessed code corrupts `sc`, and a corrupt `sc` returns zero
     * results — indistinguishable, to the user, from the extension being
     * broken.
     */
    const url = new URL(
      buildSearchUrl(
        spec({ filters: { ...emptyFilters(), workType: 'remote', experience: 'mid_senior' } }),
        'fr',
      ),
    )

    expect(url.searchParams.get('sc')).toBe(INDEED_APPLY_FILTER)
  })

  it('maps "posted" onto fromage in days', () => {
    const url = new URL(
      buildSearchUrl(spec({ filters: { ...emptyFilters(), datePosted: 'week' } }), 'fr'),
    )
    expect(url.searchParams.get('fromage')).toBe('7')
  })
})

describe('buildSearchUrl — LinkedIn', () => {
  it('builds a jobs search with the Easy Apply facet', () => {
    const url = new URL(buildSearchUrl(spec({ platform: 'linkedin' }), 'fr'))

    expect(url.hostname).toBe('www.linkedin.com')
    expect(url.pathname).toBe('/jobs/search/')
    expect(url.searchParams.get('keywords')).toBe('product owner')
    expect(url.searchParams.get('f_AL')).toBe('true')
  })

  it('maps the filters onto LinkedIn’s facet codes', () => {
    const url = new URL(
      buildSearchUrl(
        spec({
          platform: 'linkedin',
          filters: {
            location: 'Paris',
            workType: 'remote',
            experience: 'mid_senior',
            datePosted: '24h',
          },
        }),
        'fr',
      ),
    )

    expect(url.searchParams.get('location')).toBe('Paris')
    expect(url.searchParams.get('f_WT')).toBe('2')
    expect(url.searchParams.get('f_E')).toBe('4')
    expect(url.searchParams.get('f_TPR')).toBe('r86400')
  })
})

describe('an empty role', () => {
  it('throws rather than returning a search for everything', () => {
    // A run pointed at an unfiltered search works through whatever the board
    // felt like showing it, which is not what anyone asked for.
    expect(() => buildSearchUrl(spec({ role: '   ' }))).toThrow(/role/i)
  })
})
