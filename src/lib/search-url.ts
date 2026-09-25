import type { JobSource } from './schema'

/**
 * Turning "what job do you want" into a board search URL.
 *
 * This is what lets a run start from anywhere. Previously a run demanded you
 * were already sitting on a search page and refused otherwise, which is a
 * strange thing to ask: the extension knows the role you want and every board
 * encodes its search in the URL, so it can simply go there.
 *
 * Ported from `autoapplycv`'s `indeed-platform.js`, `linkedin-platform.js` and
 * `job-board-market.js` (PolyForm Noncommercial 1.0.0 — Required Notice:
 * Copyright AutoCVApply, https://autocvapply.com). See
 * docs/THIRD_PARTY_NOTICES.md.
 */

/**
 * The country site to search on.
 *
 * `fr` is an addition: the reference covers uk/us/ca/au only, because that
 * product sells into English-speaking markets. Searching `uk.indeed.com` for
 * a job in Paris returns almost nothing, so the default here is resolved from
 * the location text rather than hardcoded to one country.
 */
export const MARKETS = ['auto', 'fr', 'uk', 'us', 'ca', 'au', 'de', 'es'] as const
export type Market = (typeof MARKETS)[number]
/** A market that has actually been decided — never `auto`. */
export type ResolvedMarket = Exclude<Market, 'auto'>

export const MARKET_LABELS: Record<Market, string> = {
  auto: 'Auto (from location)',
  fr: 'France',
  uk: 'United Kingdom',
  us: 'United States',
  ca: 'Canada',
  au: 'Australia',
  de: 'Germany',
  es: 'Spain',
}

/**
 * Words in a location that pin it to a country.
 *
 * Deliberately small and specific. A guess here sends the whole run to the
 * wrong country's site, so anything ambiguous should fall through to the
 * default rather than being resolved confidently.
 */
const MARKET_HINTS: Array<{ market: ResolvedMarket; pattern: RegExp }> = [
  {
    market: 'fr',
    pattern:
      /\b(france|french|paris|lyon|marseille|toulouse|bordeaux|lille|nantes|nice|strasbourg|montpellier|rennes|grenoble|île-de-france|ile-de-france|idf)\b/i,
  },
  {
    market: 'uk',
    pattern:
      /\b(uk|u\.k\.|united kingdom|england|scotland|wales|london|manchester|birmingham|leeds|glasgow|edinburgh|bristol|liverpool|cardiff|belfast)\b/i,
  },
  {
    market: 'us',
    pattern:
      /\b(usa|u\.s\.a?\.?|united states|new york|nyc|san francisco|seattle|austin|boston|chicago|los angeles|denver|atlanta|remote us)\b/i,
  },
  { market: 'ca', pattern: /\b(canada|toronto|vancouver|montreal|montr[ée]al|ottawa|calgary)\b/i },
  { market: 'au', pattern: /\b(australia|sydney|melbourne|brisbane|perth|adelaide)\b/i },
  { market: 'de', pattern: /\b(germany|deutschland|berlin|munich|m[üu]nchen|hamburg|frankfurt|cologne|k[öo]ln)\b/i },
  { market: 'es', pattern: /\b(spain|espa[ñn]a|madrid|barcelona|valencia|sevilla|seville|bilbao)\b/i },
]

/**
 * Which country site to use, from the market setting and the location text.
 *
 * `fallback` is what an unrecognised location resolves to. It is the user's
 * own browser language rather than a hardcoded country, because the common
 * case — a French user typing a French town this list does not name — should
 * not silently search the wrong country.
 */
export function resolveMarket(
  market: Market,
  location: string,
  fallback: ResolvedMarket = 'fr',
): ResolvedMarket {
  if (market !== 'auto') return market

  const text = String(location || '').trim()
  if (!text) return fallback

  const hit = MARKET_HINTS.find((entry) => entry.pattern.test(text))
  return hit?.market ?? fallback
}

/** Guess a default market from the browser's language. */
export function marketFromBrowser(): ResolvedMarket {
  let language = ''
  try {
    language = (chrome?.i18n?.getUILanguage?.() || navigator.language || '').toLowerCase()
  } catch {
    language = ''
  }

  const region = language.split('-')[1]
  const byRegion: Record<string, ResolvedMarket> = {
    fr: 'fr',
    gb: 'uk',
    us: 'us',
    ca: 'ca',
    au: 'au',
    de: 'de',
    es: 'es',
  }
  if (region && byRegion[region]) return byRegion[region] as ResolvedMarket

  const byLanguage: Record<string, ResolvedMarket> = { fr: 'fr', en: 'uk', de: 'de', es: 'es' }
  return byLanguage[language.split('-')[0] ?? ''] ?? 'fr'
}

const INDEED_HOSTS: Record<ResolvedMarket, string> = {
  fr: 'fr.indeed.com',
  uk: 'uk.indeed.com',
  us: 'www.indeed.com',
  ca: 'ca.indeed.com',
  au: 'au.indeed.com',
  de: 'de.indeed.com',
  es: 'es.indeed.com',
}

export function indeedHost(market: ResolvedMarket): string {
  return INDEED_HOSTS[market]
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export const WORK_TYPES = ['', 'remote', 'hybrid', 'on_site'] as const
export const EXPERIENCE_LEVELS = ['', 'entry', 'associate', 'mid_senior', 'director', 'executive'] as const
export const DATE_POSTED = ['', '24h', 'week', 'month'] as const

export type SearchFilters = {
  location: string
  workType: (typeof WORK_TYPES)[number]
  experience: (typeof EXPERIENCE_LEVELS)[number]
  datePosted: (typeof DATE_POSTED)[number]
}

export const emptyFilters = (): SearchFilters => ({
  location: '',
  workType: '',
  experience: '',
  datePosted: '',
})

/** LinkedIn's own facet codes. */
const LINKEDIN_WORK_TYPE: Record<string, string> = { on_site: '1', remote: '2', hybrid: '3' }
const LINKEDIN_EXPERIENCE: Record<string, string> = {
  entry: '2',
  associate: '3',
  mid_senior: '4',
  director: '5',
  executive: '6',
}
const LINKEDIN_DATE_POSTED: Record<string, string> = {
  '24h': 'r86400',
  week: 'r604800',
  month: 'r2592000',
}

/** Indeed's "Indeed Apply only" facet. */
export const INDEED_APPLY_FILTER = '0kf:attr(DSQF7)'

/** Indeed's `fromage` is a number of days. */
const INDEED_DATE_POSTED: Record<string, string> = { '24h': '1', week: '7', month: '30' }

export type SearchSpec = {
  platform: Extract<JobSource, 'linkedin' | 'indeed'>
  role: string
  market: Market
  filters: SearchFilters
  /** Restrict to postings that can be applied to without leaving the board. */
  easyApplyOnly: boolean
  /**
   * How many applications this run may make. Separate from the daily cap,
   * which is a standing safety limit rather than "how many right now"; the
   * run engine takes whichever of the two is tighter.
   */
  maxPerRun: number
}

/**
 * The search URL for a spec.
 *
 * Throws on an empty role rather than returning a URL that lists every job on
 * the site — a run pointed at that would work through whatever the board felt
 * like showing it.
 */
export function buildSearchUrl(spec: SearchSpec, fallbackMarket?: ResolvedMarket): string {
  const role = String(spec.role || '').trim()
  if (!role) throw new Error('Type the role you are looking for first.')

  const market = resolveMarket(spec.market, spec.filters.location, fallbackMarket ?? marketFromBrowser())

  return spec.platform === 'indeed'
    ? buildIndeedUrl(role, market, spec)
    : buildLinkedInUrl(role, spec)
}

function buildIndeedUrl(role: string, market: ResolvedMarket, spec: SearchSpec): string {
  const params = new URLSearchParams({ q: role })

  const location = spec.filters.location.trim()
  if (location) params.set('l', location)

  // Indeed's own facet, so the results come back already limited to postings
  // the run can finish. Filtering after the fact means opening jobs only to
  // discover they apply somewhere else.
  if (spec.easyApplyOnly) params.set('sc', INDEED_APPLY_FILTER)

  const posted = INDEED_DATE_POSTED[spec.filters.datePosted]
  if (posted) params.set('fromage', posted)

  /*
   * Work type and experience are deliberately not sent to Indeed.
   *
   * Indeed encodes them as opaque `attr(…)` codes inside the same `sc`
   * parameter as the Indeed Apply facet, and the codes differ by country
   * site. Guessing one corrupts `sc`, and a corrupt `sc` returns *zero*
   * results — which looks exactly like the extension being broken rather
   * than like a filter being too narrow. The filters still apply to the
   * scraped titles through the existing keyword rules.
   */

  return `https://${indeedHost(market)}/jobs?${params.toString()}`
}

function buildLinkedInUrl(role: string, spec: SearchSpec): string {
  const params = new URLSearchParams({ keywords: role })

  if (spec.easyApplyOnly) params.set('f_AL', 'true')

  const location = spec.filters.location.trim()
  if (location) params.set('location', location)

  const workType = LINKEDIN_WORK_TYPE[spec.filters.workType]
  if (workType) params.set('f_WT', workType)

  const experience = LINKEDIN_EXPERIENCE[spec.filters.experience]
  if (experience) params.set('f_E', experience)

  const posted = LINKEDIN_DATE_POSTED[spec.filters.datePosted]
  if (posted) params.set('f_TPR', posted)

  return `https://www.linkedin.com/jobs/search/?${params.toString()}`
}
